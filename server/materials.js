import crypto from 'node:crypto';
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import * as cheerio from 'cheerio';

const MAX_TEXT = 120000;
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.pdf', '.docx']);

function normalizeText(text = '') {
  return text.replace(/\u0000/g, '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, MAX_TEXT);
}

function paragraphSegments(text, extra = {}) {
  let cursor = 0;
  return text.split(/\n{2,}/).map((value, index) => {
    const paragraph = value.trim();
    const start = text.indexOf(paragraph, cursor);
    cursor = Math.max(cursor, start + paragraph.length);
    const heading = paragraph.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim() || null;
    return { text: paragraph, locator: { ...extra, paragraph: index + 1, start, end: start + paragraph.length, ...(heading ? { heading } : {}) } };
  }).filter((segment) => segment.text);
}

export async function parseUploadedFile(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error('仅支持 TXT、Markdown、PDF 和 DOCX 文件');
  let text = '';
  let segments = [];
  if (extension === '.txt' || extension === '.md' || extension === '.markdown') {
    text = file.buffer.toString('utf8');
  } else if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    text = result.value;
  } else if (extension === '.pdf') {
    const parser = new PDFParse({ data: file.buffer });
    try {
      const result = await parser.getText();
      text = result.text;
      segments = result.pages.flatMap((page) => paragraphSegments(normalizeText(page.text), { page: page.num }));
    } finally {
      await parser.destroy();
    }
  }
  text = normalizeText(text);
  if (!text) throw new Error(extension === '.pdf' ? 'PDF 没有可读取文字，请换一个文件或粘贴正文' : '文件中没有可读取的文字');
  return {
    id: crypto.randomUUID(),
    kind: 'file',
    displayName: file.originalname || '用户提供的资料',
    mimeType: file.mimetype || 'application/octet-stream',
    status: 'ready',
    text,
    segments: segments.length ? segments : paragraphSegments(text),
    characterCount: [...text].length,
  };
}

export async function fetchWebMaterial(urlValue) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error('请输入完整网页链接');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 网页链接');
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Narraform/1.0' } });
  if (!response.ok) throw new Error(`网页读取失败（${response.status}）`);
  const html = await response.text();
  const $ = cheerio.load(html);
  $('script, style, nav, footer, iframe, noscript, svg').remove();
  const title = $('title').first().text().trim();
  const main = $('main, article').first();
  const text = normalizeText((main.length ? main : $('body')).text().replace(/\s+/g, ' '));
  if (text.length < 40) throw new Error('网页没有足够的可读取正文，请粘贴内容');
  return {
    id: crypto.randomUUID(),
    kind: 'url',
    displayName: title || url.hostname,
    url: url.toString(),
    status: 'ready',
    text,
    characterCount: [...text].length,
  };
}

export function createTextMaterial(text, name = '粘贴的文字') {
  const normalized = normalizeText(text);
  if (!normalized) throw new Error('请粘贴需要使用的文字');
  return {
    id: crypto.randomUUID(),
    kind: 'text',
    displayName: name,
    status: 'ready',
    text: normalized,
    characterCount: [...normalized].length,
  };
}

export function publicMaterial(material) {
  const { text, segments, ...safe } = material;
  return { ...safe, excerpt: text.slice(0, 120) };
}
