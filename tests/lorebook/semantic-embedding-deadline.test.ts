import { EmbeddingProvider } from '../../src/shared/apiConnection';

const provider=()=>new EmbeddingProvider('custom','fixture','https://embedding.invalid/v1','fixture-key',2,'query');
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;});
test('optional query propagates cancellation into its single actual HTTP attempt',async()=>{
    const fetch=jest.fn((_url:any,options:any)=>new Promise((_resolve,reject)=>{
        options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
    }));global.fetch=fetch as any;
    const signal=AbortSignal.timeout(20),result=provider().embedOnce('Synthetic query.',signal);
    await expect(result).rejects.toHaveProperty('name','TimeoutError');
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].signal).toBe(signal);
});
test('optional query does not retry a transient service failure',async()=>{
    const fetch=jest.fn(async()=>({ok:false,status:503,text:async()=>'fixture outage'}));global.fetch=fetch as any;
    await expect(provider().embedOnce('Synthetic query.',AbortSignal.timeout(100))).rejects.toHaveProperty('status',503);
    expect(fetch).toHaveBeenCalledTimes(1);
});
test('already cancelled optional query sends no request',async()=>{
    const fetch=jest.fn();global.fetch=fetch as any;const cancel=new AbortController();cancel.abort(new Error('fixture cancellation'));
    await expect(provider().embedOnce('Synthetic query.',cancel.signal)).rejects.toThrow('fixture cancellation');expect(fetch).not.toHaveBeenCalled();
});
test('successful optional query preserves standard model, dimension and query-role request',async()=>{
    const fetch=jest.fn(async(_url:any,_options:any)=>({ok:true,json:async()=>({data:[{embedding:[1,0]}]})}));global.fetch=fetch as any;
    expect(await provider().embedOnce('Synthetic query.',AbortSignal.timeout(100))).toEqual([1,0]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({model:'fixture',input:'Synthetic query.',dimensions:2,input_type:'query'});
});
