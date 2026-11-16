// ===== 小说文件解析 =====
// 只做「文件 -> 书名 / 作者 / 章节 / 段落」的纯解析，不碰界面和存储。
// 支持 TXT（UTF-8 / GBK）、EPUB（内置 ZIP 解析）、PDF（懒加载 pdf.js）。

const BOOK_HEADING_RE = /^\s*(?:第[0-9一二三四五六七八九十百千万零〇两]+[章节回卷篇部集]|序章|楔子|引子|尾声|后记|番外(?:篇)?)[^\n]{0,30}$/;

function decodeBookText(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = new TextDecoder('utf-8').decode(bytes);
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 0 && bad > text.length * 0.003) {
    try { text = new TextDecoder('gbk').decode(bytes); } catch (_) {}
  }
  return text.replace(/^\uFEFF/, '');
}

function bookTextToParagraphs(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split(/\n+/);
  const out = [];
  lines.forEach((line) => {
    const p = line.replace(/[ \t\u3000]+/g, ' ').trim();
    if (!p) return;
    if (/^[-=_*·•—]{3,}$/.test(p)) return;
    out.push(p);
  });
  return out;
}

function bookSplitChunks(paragraphs, maxChars) {
  const chunks = [];
  let current = [];
  let size = 0;
  paragraphs.forEach((p) => {
    if (current.length && size + p.length > (maxChars || 6000)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.length;
  });
  if (current.length) chunks.push(current);
  return chunks;
}

function splitBookText(text, fallbackTitle) {
  const paragraphs = bookTextToParagraphs(text);
  if (!paragraphs.length) return [];
  const chapters = [];
  let current = { title: '', paragraphs: [] };

  paragraphs.forEach((p) => {
    if (BOOK_HEADING_RE.test(p) && p.length <= 40) {
      if (current.paragraphs.length) {
        chapters.push(current);
      }
      current = { title: p.trim(), paragraphs: [] };
      return;
    }
    current.paragraphs.push(p);
  });
  if (current.paragraphs.length) chapters.push(current);

  if (!chapters.length) chapters.push({ title: '', paragraphs });
  if (chapters.length === 1) {
    const chunks = bookSplitChunks(chapters[0].paragraphs, 6000);
    return chunks.map((list, i) => ({
      title: chunks.length > 1 ? ('第 ' + (i + 1) + ' 节') : (fallbackTitle || chapters[0].title || '全文'),
      paragraphs: list,
    }));
  }
  return chapters.map((c, i) => ({
    title: c.title || ((fallbackTitle || '正文') + ' · ' + (i + 1)),
    paragraphs: c.paragraphs,
  }));
}

async function parseTxtBook(file) {
  const text = decodeBookText(await file.arrayBuffer());
  const base = String(file.name || '未命名小说').replace(/\.[^.]+$/, '');
  const chapters = splitBookText(text, base);
  if (!chapters.length) throw new Error('TXT 里没有解析到正文');
  return { title: base, author: '', format: 'txt', chapters };
}

// ---- EPUB：最小 ZIP 读取（stored / deflate-raw） ----
function epubReadZip(buffer) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const dec = new TextDecoder('utf-8');
  let eocd = -1;
  const start = Math.max(0, u8.length - 65557);
  for (let i = u8.length - 22; i >= start; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EPUB 文件损坏：找不到 ZIP 目录');
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (ptr + 46 > u8.length || view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = dec.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
    entries.set(name, { method, compSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  async function read(name) {
    const entry = entries.get(name);
    if (!entry) return null;
    const local = entry.localOffset;
    if (view.getUint32(local, true) !== 0x04034b50) return null;
    const nameLen = view.getUint16(local + 26, true);
    const extraLen = view.getUint16(local + 28, true);
    const dataStart = local + 30 + nameLen + extraLen;
    const data = u8.slice(dataStart, dataStart + entry.compSize);
    if (entry.method === 0) return data;
    if (entry.method !== 8) return null;
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解析 EPUB，请换用新版 Chrome / Safari');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  return { entries, read };
}

function epubResolvePath(baseDir, href) {
  let decoded = String(href || '').split('#')[0];
  try { decoded = decodeURIComponent(decoded); } catch (_) {}
  const parts = (baseDir + '/' + decoded).split('/');
  const out = [];
  parts.forEach((p) => {
    if (!p || p === '.') return;
    if (p === '..') out.pop();
    else out.push(p);
  });
  return out.join('/');
}

function epubElements(doc, localName) {
  return Array.from(doc.getElementsByTagName('*')).filter((el) => {
    const name = el.localName || el.tagName || '';
    return name.split(':').pop() === localName;
  });
}

function epubXmlText(doc, names) {
  for (const name of names) {
    const els = epubElements(doc, name.split(':').pop());
    for (const el of els) {
      const t = String(el.textContent || '').trim();
      if (t) return t;
    }
  }
  return '';
}

function epubHtmlToParagraphs(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,svg').forEach((el) => el.remove());
  const blocks = Array.from(doc.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre'));
  const list = [];
  blocks.forEach((el) => {
    if (el.querySelector('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre')) return;
    const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) list.push(text);
  });
  if (!list.length) {
    String(doc.body.textContent || '').split(/\n+/).forEach((line) => {
      const t = line.replace(/\s+/g, ' ').trim();
      if (t) list.push(t);
    });
  }
  const seen = [];
  list.forEach((p) => {
    if (seen[seen.length - 1] !== p) seen.push(p);
  });
  return seen;
}

function epubChapterTitle(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const h = doc.querySelector('h1,h2,h3');
  const title = h ? String(h.textContent || '').replace(/\s+/g, ' ').trim() : '';
  return title || String(doc.title || '').trim();
}

async function parseEpubBook(file) {
  const zip = epubReadZip(await file.arrayBuffer());
  const containerBytes = await zip.read('META-INF/container.xml');
  if (!containerBytes) throw new Error('EPUB 缺少 container.xml');
  const container = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(containerBytes), 'application/xml');
  const rootfile = epubElements(container, 'rootfile')[0];
  const opfPath = rootfile && rootfile.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB 缺少 OPF 文件');
  const opfBytes = await zip.read(opfPath);
  if (!opfBytes) throw new Error('EPUB 的 OPF 文件读取失败');
  const opf = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(opfBytes), 'application/xml');
  const baseDir = opfPath.split('/').slice(0, -1).join('/');

  const title = epubXmlText(opf, ['dc:title', 'title']) || String(file.name || '未命名小说').replace(/\.[^.]+$/, '');
  const author = epubXmlText(opf, ['dc:creator', 'creator']);

  const manifest = new Map();
  epubElements(opf, 'item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifest.set(id, {
        href,
        path: epubResolvePath(baseDir, href),
        mediaType: item.getAttribute('media-type') || '',
        properties: item.getAttribute('properties') || '',
      });
    }
  });

  let spine = epubElements(opf, 'itemref')
    .map((x) => manifest.get(x.getAttribute('idref')))
    .filter(Boolean);
  if (!spine.length) {
    spine = Array.from(manifest.values()).filter((x) => /xhtml|html/.test(x.mediaType));
  }

  const chapters = [];
  for (const item of spine) {
    if (/nav/.test(item.properties)) continue;
    if (!/xhtml|html/.test(item.mediaType) && !/\.x?html?$/i.test(item.path)) continue;
    const bytes = await zip.read(item.path);
    if (!bytes) continue;
    const html = new TextDecoder('utf-8').decode(bytes);
    const paragraphs = epubHtmlToParagraphs(html);
    if (!paragraphs.length) continue;
    const chapterTitle = epubChapterTitle(html) || ('第 ' + (chapters.length + 1) + ' 章');
    if (paragraphs[0] === chapterTitle) paragraphs.shift();
    if (!paragraphs.length) continue;
    chapters.push({ title: chapterTitle, paragraphs });
  }
  if (!chapters.length) throw new Error('EPUB 里没有解析到正文');
  return { title, author, format: 'epub', chapters };
}

// ---- PDF：懒加载 pdf.js，按文本行拼接后自动分章 ----
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      if (!window.pdfjsLib) { reject(new Error('PDF 解析组件加载失败')); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('PDF 解析组件加载失败，请检查网络后重试'));
    document.head.appendChild(script);
  });
}

async function parsePdfBook(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    let line = '';
    content.items.forEach((item) => {
      if (!item || !item.str) return;
      const y = item.transform ? item.transform[5] : lastY;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        text += line + '\n';
        line = '';
      }
      line += item.str;
      lastY = y;
    });
    text += line + '\n';
  }
  const base = String(file.name || '未命名小说').replace(/\.[^.]+$/, '');
  const chapters = splitBookText(text, base);
  if (!chapters.length) throw new Error('PDF 里没有解析到可选择的文字（可能是扫描版）');
  return { title: base, author: '', format: 'pdf', chapters };
}

async function parseBookFile(file) {
  const name = String((file && file.name) || '').toLowerCase();
  if (name.endsWith('.txt')) return parseTxtBook(file);
  if (name.endsWith('.epub')) return parseEpubBook(file);
  if (name.endsWith('.pdf')) return parsePdfBook(file);
  throw new Error('仅支持 TXT / EPUB / PDF 格式');
}
