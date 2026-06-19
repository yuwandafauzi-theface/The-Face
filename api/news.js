// GET /api/news — serves latest news from data/news.json
import { readFileSync } from 'fs';
import { join } from 'path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  try {
    const filePath = join(process.cwd(), 'data', 'news.json');
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    res.status(200).json({ ok: true, updatedAt: data.updatedAt, items: data.items });
  } catch {
    res.status(500).json({ ok: false, error: 'Gagal membaca data berita.' });
  }
}
