import fs from 'fs';
import os from 'os';
import path from 'path';
import { EmbeddingProvider } from '../../src/shared/apiConnection';
import { LorebookVectors, embeddingBinding, LORE_QUALIFIED_EMBEDDING_RECIPE } from '../../src/main/lorebook/lorebookVectors';

test('an interrupted index resumes committed candidates, and another model cannot query its vectors', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-lore-vectors-'));
    const docs = [{ id: 'a', title: 'First', text: 'Book account one.', embedding_text: 'Scholars — Herbal Practice\nBook account one.', body_sha256: 'hash-a' },
        { id: 'b', title: 'Second', text: 'Book account two.', body_sha256: 'hash-b' }];
    const client: any = { request: jest.fn(async body => body.after ? [] : docs) };
    const index = new LorebookVectors(client);
    const config: any = { embeddingApiConnectionConfig: { connection: { type: 'custom', model: 'fixture-model', baseUrl: 'https://embedding.invalid',
        useCustomEmbeddingDimension: true, embeddingDimension: 2 } } };
    const edition: any = { manifest_sha256: 'fixture-edition' };
    const embed = jest.spyOn(EmbeddingProvider.prototype, 'embed');
    try {
        embed.mockResolvedValueOnce([1, 0]).mockRejectedValueOnce(new Error('synthetic interruption'));
        await expect(index.build(config, directory, edition)).rejects.toThrow('synthetic interruption');
        expect(embed).toHaveBeenNthCalledWith(1, docs[0].embedding_text);
        expect(index.status().state).toContain('paused');
        embed.mockResolvedValue([0, 1]);
        await index.build(config, directory, edition);
        expect(embed).toHaveBeenCalledTimes(3); // candidate a survived and was not sent twice
        expect(index.status().state).toBe('Semantic index ready');
        embed.mockResolvedValue([1, 0]);
        expect(await index.search(config, directory, edition, 'A query')).toEqual(['a', 'b']);
        const calls = embed.mock.calls.length;
        config.embeddingApiConnectionConfig.connection.model = 'another-model';
        expect(await index.search(config, directory, edition, 'A query')).toEqual([]);
        expect(embed.mock.calls.length).toBe(calls);
    } finally { embed.mockRestore(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('qualified index has a separate space and returns relevance scores without granting a body',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'titan-qualified-vectors-'));
    const docs=[{id:'a',text:'First existing account.',body_sha256:'one'},{id:'b',text:'Second existing account.',body_sha256:'two'}];
    const client:any={request:jest.fn(async body=>body.after?[]:docs)};
    const index=new LorebookVectors(client),config:any={embeddingApiConnectionConfig:{connection:{type:'custom',model:'fixture',baseUrl:'https://embedding.invalid',embeddingInputType:'document',useCustomEmbeddingDimension:true,embeddingDimension:2}}};
    const edition:any={manifest_sha256:'edition',authored_qualified:2},embed=jest.spyOn(EmbeddingProvider.prototype,'embed'),once=jest.spyOn(EmbeddingProvider.prototype,'embedOnce').mockResolvedValue([1,0]);
    try{
        embed.mockResolvedValueOnce([.8,.6]).mockResolvedValueOnce([-.2,Math.sqrt(.96)]);
        await index.build(config,directory,edition,true);
        expect(client.request).toHaveBeenCalledWith({op:'qualified-documents',after:''});
        expect(embeddingBinding(config,'edition',LORE_QUALIFIED_EMBEDDING_RECIPE)).not.toBe(embeddingBinding(config,'edition'));
        const before=embed.mock.calls.length;expect(await index.search(config,directory,edition,'ordinary')).toEqual([]);expect(embed).toHaveBeenCalledTimes(before);
        embed.mockResolvedValue([1,0]);const matches=await index.rankQualified(config,directory,edition,'A semantic question.');
        expect(matches).toHaveLength(2);expect(matches[0].id).toBe('a');expect(matches[0].score).toBeCloseTo(.8);expect(matches[1].score).toBeCloseTo(-.2);expect(matches[0]).not.toHaveProperty('text');
        config.embeddingApiConnectionConfig.connection.model='different';const calls=once.mock.calls.length;
        expect(await index.rankQualified(config,directory,edition,'Question')).toEqual([]);expect(once).toHaveBeenCalledTimes(calls);
    }finally{embed.mockRestore();once.mockRestore();fs.rmSync(directory,{recursive:true,force:true});}
});
test('qualified index requires its exact edition row count before it becomes ready',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'titan-qualified-count-'));
    const client:any={request:jest.fn(async()=>[])},index=new LorebookVectors(client);
    const config:any={embeddingApiConnectionConfig:{connection:{type:'custom',model:'fixture',baseUrl:'https://embedding.invalid'}}};
    try{await expect(index.build(config,directory,{manifest_sha256:'edition',authored_qualified:2}as any,true)).rejects.toThrow('does not match');
        expect(await index.rankQualified(config,directory,{manifest_sha256:'edition',authored_qualified:2}as any,'Question')).toEqual([]);
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
