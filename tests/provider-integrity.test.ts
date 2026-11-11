import { ApiConnection } from '../src/shared/apiConnection';
const prompt: any = [{role:'user', content:'A fixture question.'}];
function api(type: string, chat = true): any {
 return Object.assign(Object.create(ApiConnection.prototype), { type, model:'fixture-model', parameters:{temperature:.7}, config:{key:'fixture'},
  isChat:()=>chat, client:{baseURL:'https://fixture.invalid',apiKey:'fixture'} });
}
beforeEach(()=>{for(const name of ['debug','log','error'] as const)jest.spyOn(console,name).mockImplementation(()=>{});});
afterEach(()=>{jest.restoreAllMocks();});
test.each(['gemini','glm','novelai'])('%s forwards a caller cap and observes token exhaustion without retry',async type=>{
 const value= type==='gemini'?{candidates:[{content:{parts:[]},finishReason:'MAX_TOKENS'}]}:{choices:[{text:'',message:{content:''},finish_reason:'length'}]};
 const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue(new Response(JSON.stringify(value),{status:200}));
 const metadata=jest.fn(); const connection=api(type);
 expect(await connection.complete(prompt,false,{max_tokens:73},undefined,undefined,undefined,undefined,metadata)).toBe('');
 expect(fetchMock).toHaveBeenCalledTimes(1); const body=JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
 expect(type==='gemini'?body.generationConfig.maxOutputTokens:body.max_tokens).toBe(73);
 expect(metadata).toHaveBeenCalledWith({finishReason:'length'});
});
test.each([false,true])('Gemini joins answer parts and withholds thought text (stream=%s)',async stream=>{
 const candidate={content:{parts:[{text:'PRIVATE_THOUGHT',thought:true},{text:'The '},{inlineData:{}},{text:'answer.'}]},finishReason:'STOP'};
 const response=stream?'data: '+JSON.stringify({candidates:[candidate]})+'\n\n':JSON.stringify({candidates:[candidate]});
 jest.spyOn(global,'fetch').mockResolvedValue(new Response(response,{status:200}));
 const relay=jest.fn(),metadata=jest.fn(); const result=await api('gemini').complete(prompt,stream,{},relay,undefined,undefined,undefined,metadata);
 expect(result).toBe('The answer.');expect(JSON.stringify(relay.mock.calls)).not.toContain('PRIVATE_THOUGHT');expect(metadata).toHaveBeenCalledWith({finishReason:'stop'});
});
test.each([true,false])('usage-only stream frames do not retry or duplicate text (chat=%s)',async chat=>{
 const connection=api('custom',chat), create=jest.fn().mockImplementation(async()=> (async function*(){
  yield {choices:[chat?{delta:{content:'Only once.'}}:{text:'Only once.'}]};
  yield {choices:[chat?{delta:{},finish_reason:'stop'}:{text:'',finish_reason:'stop'}]};
  yield {choices:[],usage:{total_tokens:50}};
 })());
 connection.client={chat:{completions:{create}},completions:{create}};
 const relay=jest.fn(),metadata=jest.fn();
 expect(await connection.complete(chat?prompt:'A question',true,{},relay,undefined,undefined,undefined,metadata)).toBe('Only once.');
 expect(create).toHaveBeenCalledTimes(1); expect(relay).toHaveBeenCalledTimes(1);expect(metadata).toHaveBeenCalledWith({finishReason:'stop'});
});
test('GLM stream observes a finish-only frame followed by usage',async()=>{
 const frames=[{choices:[{delta:{content:'Done.'}}]},{choices:[{delta:{},finish_reason:'length'}]},{choices:[],usage:{total_tokens:5}}];
 jest.spyOn(global,'fetch').mockResolvedValue(new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join('')));
 const metadata=jest.fn(); expect(await api('glm').complete(prompt,true,{},()=>{},undefined,undefined,undefined,metadata)).toBe('Done.');
 expect(metadata).toHaveBeenCalledWith({finishReason:'length'});
});
