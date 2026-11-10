"""Bounded, model-free Vulkan compute check. Uses Python's standard library only."""
import ctypes as c
import ctypes.util
import json
import struct

class Application(c.Structure):
    _fields_ = [('type', c.c_uint32), ('next', c.c_void_p), ('name', c.c_char_p), ('version', c.c_uint32),
                ('engine', c.c_char_p), ('engine_version', c.c_uint32), ('api', c.c_uint32)]
class InstanceInfo(c.Structure):
    _fields_ = [('type', c.c_uint32), ('next', c.c_void_p), ('flags', c.c_uint32), ('app', c.POINTER(Application)),
                ('layers', c.c_uint32), ('layer_names', c.c_void_p), ('extensions', c.c_uint32), ('extension_names', c.c_void_p)]
class QueueInfo(c.Structure):
    _fields_ = [('type', c.c_uint32), ('next', c.c_void_p), ('flags', c.c_uint32), ('family', c.c_uint32),
                ('count', c.c_uint32), ('priorities', c.POINTER(c.c_float))]
class DeviceInfo(c.Structure):
    _fields_ = [('type', c.c_uint32), ('next', c.c_void_p), ('flags', c.c_uint32), ('queues', c.c_uint32),
                ('queue_info', c.POINTER(QueueInfo)), ('layers', c.c_uint32), ('layer_names', c.c_void_p),
                ('extensions', c.c_uint32), ('extension_names', c.c_void_p), ('features', c.c_void_p)]

def check():
    vk = c.CDLL(ctypes_path())
    # Explicit prototypes keep pointer widths correct on Linux x64.
    vk.vkCreateInstance.argtypes = [c.POINTER(InstanceInfo), c.c_void_p, c.POINTER(c.c_void_p)]
    vk.vkDestroyInstance.argtypes = [c.c_void_p, c.c_void_p]
    vk.vkEnumeratePhysicalDevices.argtypes = [c.c_void_p, c.POINTER(c.c_uint32), c.POINTER(c.c_void_p)]
    vk.vkGetPhysicalDeviceProperties.argtypes = [c.c_void_p, c.c_void_p]
    vk.vkGetPhysicalDeviceQueueFamilyProperties.argtypes = [c.c_void_p, c.POINTER(c.c_uint32), c.c_void_p]
    vk.vkCreateDevice.argtypes = [c.c_void_p, c.POINTER(DeviceInfo), c.c_void_p, c.POINTER(c.c_void_p)]
    vk.vkDestroyDevice.argtypes = [c.c_void_p, c.c_void_p]
    app = Application(type=0, api=(1 << 22) | (2 << 12))  # Vulkan 1.2, matching the pinned runtime.
    info = InstanceInfo(type=1, app=c.pointer(app)); instance = c.c_void_p()
    if vk.vkCreateInstance(c.byref(info), None, c.byref(instance)) != 0:
        return {'gpu': False}
    try:
        count = c.c_uint32()
        if vk.vkEnumeratePhysicalDevices(instance, c.byref(count), None) != 0 or count.value > 64:
            return {'gpu': False}
        devices = (c.c_void_p * count.value)()
        if vk.vkEnumeratePhysicalDevices(instance, c.byref(count), devices) != 0:
            return {'gpu': False}
        for device in devices:
            properties = c.create_string_buffer(4096)
            vk.vkGetPhysicalDeviceProperties(device, properties)
            api, _, vendor, _, kind = struct.unpack_from('=5I', properties.raw)
            if kind != 2 or api < app.api:  # Grant dedicated-memory credit only to discrete GPUs.
                continue
            families = c.c_uint32()
            vk.vkGetPhysicalDeviceQueueFamilyProperties(device, c.byref(families), None)
            if families.value > 256:
                continue
            queues = c.create_string_buffer(24 * families.value)
            vk.vkGetPhysicalDeviceQueueFamilyProperties(device, c.byref(families), queues)
            for index in range(families.value):
                flags, available = struct.unpack_from('=2I', queues.raw, index * 24)
                if not flags & 2 or not available:
                    continue
                priority = c.c_float(1)
                queue = QueueInfo(type=2, family=index, count=1, priorities=c.pointer(priority))
                create = DeviceInfo(type=3, queues=1, queue_info=c.pointer(queue)); logical = c.c_void_p()
                if vk.vkCreateDevice(device, c.byref(create), None, c.byref(logical)) == 0:
                    vk.vkDestroyDevice(logical, None)
                    return {'gpu': True, 'vendor': {0x1002: 'AMD', 0x10de: 'NVIDIA', 0x8086: 'Intel'}.get(vendor, 'GPU')}
        return {'gpu': False}
    finally:
        vk.vkDestroyInstance(instance, None)

def ctypes_path():
    return c.util.find_library('vulkan') or 'libvulkan.so.1'

if __name__ == '__main__':
    try:
        print(json.dumps(check()))
    except (OSError, ValueError, AttributeError):
        print(json.dumps({'gpu': False}))
