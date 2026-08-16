import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph } from 'docx';
import { createTextMaterial, fetchWebMaterial, parseUploadedFile } from '../server/materials.js';
import { deleteContent, getContent, getMaterials, getTask, listContents, resetStore, saveContent, saveMaterial, saveTask, selectTaskStrategy } from '../server/store.js';
import { createTaskBrief } from '../server/task-understanding.js';

test.beforeEach(async () => resetStore());

test('文本和 Markdown 文件可以解析', async () => {
  const text = createTextMaterial('产品支持多租户和权限控制。');
  assert.equal(text.status, 'ready');
  const markdown = await parseUploadedFile({ originalname: 'README.md', mimetype: 'text/markdown', buffer: Buffer.from('# 标题\n\n产品支持工作流。') });
  assert.match(markdown.text, /产品支持工作流/);
});

test('PDF 文件可以解析', async () => {
  const chunks = [];
  const document = new PDFDocument();
  document.on('data', chunk => chunks.push(chunk));
  const completed = new Promise(resolve => document.on('end', resolve));
  document.text('Narraform supports platform copy generation and quality checks.');
  document.end();
  await completed;
  const parsed = await parseUploadedFile({ originalname: 'product.pdf', mimetype: 'application/pdf', buffer: Buffer.concat(chunks) });
  assert.match(parsed.text, /Narraform supports platform copy generation/);
});

test('DOCX 文件可以解析', async () => {
  const document = new Document({ sections: [{ children: [new Paragraph('Narraform supports Zhihu and WeChat copy generation.')] }] });
  const buffer = await Packer.toBuffer(document);
  const parsed = await parseUploadedFile({ originalname: 'product.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  assert.match(parsed.text, /Narraform supports Zhihu and WeChat/);
});

test('用户主动提供的网页可以解析', async () => {
  const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<html><head><title>Product</title></head><body><nav>menu</nav><main><h1>Narraform</h1><p>Narraform generates copy for different content platforms and keeps facts separate from source metadata.</p></main></body></html>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const parsed = await fetchWebMaterial(`http://127.0.0.1:${address.port}/product`);
    assert.match(parsed.text, /Narraform generates copy/);
    assert.doesNotMatch(parsed.text, /menu/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('不支持的文件给出可行动错误', async () => {
  await assert.rejects(() => parseUploadedFile({ originalname: 'image.png', buffer: Buffer.from('x') }), /仅支持/);
});

test('内容保存、追加版本、读取和删除形成闭环', async () => {
  const material = await saveMaterial(createTextMaterial('产品支持 RBAC。'));
  const first = await saveContent({ name: '产品介绍', platform: 'xiaohongshu', materialIds: [material.id], bodyMarkdown: '第一版', titleCandidates: ['标题一', '标题二'], selectedTitleIndex: 1 });
  const second = await saveContent({ id: first.id, name: '产品介绍', platform: 'xiaohongshu', materialIds: [material.id], bodyMarkdown: '第二版', titleCandidates: ['标题二'], selectedTitleIndex: 0, reason: 'rewrite' });
  assert.equal(second.versions.length, 2);
  assert.equal((await listContents())[0].versionCount, 2);
  assert.equal((await getContent(first.id)).versions.at(-1).bodyMarkdown, '第二版');
  assert.equal((await getContent(first.id)).versions[0].selectedTitleIndex, 1);
  assert.equal((await getMaterials([material.id])).length, 1);
  assert.equal(await deleteContent(first.id), true);
  assert.equal(await getContent(first.id), null);
  assert.equal((await getMaterials([material.id])).length, 0);
});

test('任务保存、读取和策略选择形成闭环', async () => {
  const material = await saveMaterial(createTextMaterial('Narraform 支持小红书、知乎和公众号文案。系统先抽取可用事实，再按平台规则生成内容。生成后会检查事实边界和平台结构，适合需要多平台创作的内容运营。'));
  const { taskBrief } = createTaskBrief({ instruction: '产品名是 Narraform，写一篇自然的产品介绍', platform: 'xiaohongshu', materials: [material] });
  await saveTask(taskBrief);
  assert.equal((await getTask(taskBrief.taskId)).strategyOptions.length, 3);
  const selected = await selectTaskStrategy(taskBrief.taskId, taskBrief.strategyOptions[1].id);
  assert.equal(selected.status, 'ready_to_generate');
  assert.equal((await getTask(taskBrief.taskId)).selectedStrategyId, taskBrief.strategyOptions[1].id);
});
