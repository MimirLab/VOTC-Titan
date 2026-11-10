/** Exact selected audition DSP, applied once to a complete generated utterance. */
import { spawn } from 'child_process';
import type { FamilyPreset } from './familyPerformance';
export const FAMILY_PCM_LIMIT = 8 * 1024 * 1024;
function rms(x:Float64Array):number {let sum=0;for(const v of x)sum+=v*v;return Math.sqrt(sum/x.length);}
function read(pcm:Buffer):Float64Array {const x=new Float64Array(pcm.length/2);for(let i=0;i<x.length;i++)x[i]=pcm.readInt16LE(i*2)/32768;return x;}
function rounded(v:number):number {const f=Math.floor(v),d=v-f;return d===.5 ? f%2===0?f:f+1 : Math.round(v);}
async function pitch(pcm:Buffer,semitones:number,preserve:boolean,signal:AbortSignal):Promise<Float64Array> {
    return new Promise((resolve,reject)=>{
        const child=spawn('ffmpeg',['-nostdin','-v','error','-f','s16le','-ar','24000','-ac','1','-i','pipe:0','-af',
            `rubberband=tempo=1:pitch=${2**(semitones/12)}:formant=${preserve?'preserved':'shifted'}:pitchq=quality`,
            '-ac','1','-ar','24000','-f','s16le','pipe:1'],{signal,windowsHide:true});
        const chunks:Buffer[]=[];let bytes=0,stderr='';
        child.stdout.on('data',(data:Buffer)=>{bytes+=data.length;if(bytes>FAMILY_PCM_LIMIT){child.kill();reject(new Error('Demon voice processing exceeded its audio limit.'));}else chunks.push(data);});
        child.stderr.on('data',(data:Buffer)=>{if(stderr.length<2000)stderr+=data.toString();});
        child.stdin.on('error',()=>{});
        child.on('error',error=>reject(signal.aborted?signal.reason:new Error('Demon voice layers require FFmpeg with the rubberband filter. '+error.message)));
        child.on('close',code=>{if(code!==0)reject(new Error('Demon voice layers could not be processed. Check FFmpeg/rubberband. '+stderr));else {const out=Buffer.concat(chunks);if(!out.length||out.length%2)reject(new Error('Incomplete demon voice layer.'));else resolve(read(out));}});
        child.stdin.end(pcm);
    });
}
export async function applyFamilyEffects(pcm:Buffer,preset:FamilyPreset,signal:AbortSignal):Promise<Buffer> {
    signal.throwIfAborted();
    if(!preset.effect)return pcm;
    if(!pcm.length||pcm.length%2||pcm.length>FAMILY_PCM_LIMIT)throw new Error('Incomplete or oversized demon voice utterance.');
    const x=read(pcm),n=x.length,inputRms=rms(x),s=preset.effect;
    if(!inputRms)return pcm;
    let y=new Float64Array(x);
    if(preset.effectAlgorithm==='pass2-effects'){
        const normal=Math.tanh(s.drive);
        for(let i=0;i<n;i++)y[i]=(1-s.wet)*x[i]+s.wet*Math.tanh(x[i]*s.drive)/normal*((1-s.ringDepth)+s.ringDepth*Math.cos(2*Math.PI*s.ringHz*i/24000));
        const tail=Math.max(0,...s.echo.map(([ms]:number[])=>rounded(ms*24)));
        if(tail){const original=y;y=new Float64Array(n+tail);y.set(original);for(const [ms,gain] of s.echo)for(let i=0;i<n;i++)y[i+rounded(ms*24)]+=gain*original[i];}
    }else if(preset.effectAlgorithm==='vocal-grit'||preset.effectAlgorithm==='pitch-layers'){
        for(const [semitones,weight] of s.layers){
            const layer=await pitch(pcm,semitones,preset.effectAlgorithm==='vocal-grit',signal),layerRms=rms(layer);
            if(layerRms)for(let i=0;i<Math.min(n,layer.length);i++)y[i]+=weight*layer[i]*inputRms/layerRms;
        }
        for(let i=0;i<n;i++){
            if(preset.effectAlgorithm==='vocal-grit'){
                const scale=.20/inputRms;y[i]=(1-s.wet)*y[i]+s.wet*Math.tanh(y[i]*scale*s.drive)/Math.tanh(s.drive)/scale;
            }else{
                if(s.ringWet)y[i]*=(1-s.ringWet)+s.ringWet*Math.cos(2*Math.PI*s.ringHz*i/24000);
                if(s.wet)y[i]=(1-s.wet)*y[i]+s.wet*Math.tanh(s.drive*y[i])/Math.tanh(s.drive);
            }
        }
    }else throw new Error('Unknown selected demon voice effect.');
    signal.throwIfAborted();let sum=0,peak=0;for(let i=0;i<y.length;i++){if(i<n)sum+=y[i]*y[i];peak=Math.max(peak,Math.abs(y[i]));}
    const gain=Math.min(inputRms/Math.sqrt(sum/n),.97/peak),out=Buffer.alloc(y.length*2);
    for(let i=0;i<y.length;i++)out.writeInt16LE(rounded(Math.max(-1,Math.min(1,y[i]*gain))*32767),i*2);
    return out;
}
