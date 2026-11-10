import { ApiConnection } from '../../src/shared/apiConnection';
import { designPersonalityStyle, personalityStylePrompt } from '../../src/main/audio/personalityStyle';
jest.mock('../../src/shared/apiConnection');
const complete=jest.fn(),traits=[{category:'childhood' as const,name:'Curious'}];
const conv={config:{textGenerationApiConnectionConfig:{connection:{model:'configured-model'},parameters:{}}},textGenApiConnection:{encoder:null}} as any;
beforeEach(()=>{jest.clearAllMocks();(ApiConnection as jest.Mock).mockImplementation(()=>({isChat:()=>true,complete}));});
test('personality interpretation stays in its own attached-model request and cannot supply spoken words',async()=>{
    complete.mockResolvedValue('{"deliveryStyle":"Use lightly exploratory phrasing and unhurried emphasis."}');
    expect(await designPersonalityStyle(conv,traits,new AbortController().signal)).toContain('exploratory');
    const input=complete.mock.calls[0][0];expect(input).toEqual(personalityStylePrompt(traits));expect(JSON.stringify(input)).not.toContain('Hidden canonical');
    expect(JSON.stringify(input)).toContain('Do not include dialogue');expect((ApiConnection as jest.Mock).mock.calls[0][0].model).toBe('configured-model');
});
test('missing traits require no model request and abort/invalid output never becomes cached guidance',async()=>{
    expect(await designPersonalityStyle(conv,[],new AbortController().signal)).toBe('');expect(complete).not.toHaveBeenCalled();
    for(const output of ['bad JSON','{"deliveryStyle":"<titan_audio>bad</titan_audio>"}',JSON.stringify({deliveryStyle:'a'.repeat(301)})]){complete.mockResolvedValueOnce(output);await expect(designPersonalityStyle(conv,traits,new AbortController().signal)).rejects.toThrow('invalid speaking habits');}
    const c=new AbortController();c.abort();await expect(designPersonalityStyle(conv,traits,c.signal)).rejects.toThrow();
});
