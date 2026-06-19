/**
 * Vercel Cron — berjalan setiap hari jam 08:00 WIB (01:00 UTC)
 * Fetch berita terbaru DPR/politisi Indonesia → simpan ke GitHub → Vercel auto-deploy
 *
 * Env vars yang dibutuhkan (set di Vercel Dashboard → Settings → Environment Variables):
 *   GNEWS_API_KEY     — dari https://gnews.io (gratis 100 req/hari)
 *   GITHUB_TOKEN      — Personal Access Token dengan scope "repo"
 *   GITHUB_REPO_OWNER — contoh: yuwandafauzi-theface
 *   GITHUB_REPO_NAME  — contoh: The-Face
 */

const SENTIMENT_MAP = {
  keywords_pos: ['setuju','mendukung','apresiasi','capaian','sahkan','lindungi','progresif','responsif','maju','berhasil','baik','positif'],
  keywords_neg: ['dikecam','kritik','tolak','demo','protes','korupsi','masalah','gagal','buruk','jelek','minta mundur','panas'],
  keywords_warn: ['pertanyakan','evaluasi','perlu','kritis','waspada','dorong','desak','minta'],
};

function detectSentiment(text) {
  const t = text.toLowerCase();
  if (SENTIMENT_MAP.keywords_neg.some(k => t.includes(k))) return { cls:'sent-neg', icon:'ti-flame', label:'Panas' };
  if (SENTIMENT_MAP.keywords_pos.some(k => t.includes(k))) return { cls:'sent-pos', icon:'ti-thumb-up', label:'Positif' };
  if (SENTIMENT_MAP.keywords_warn.some(k => t.includes(k))) return { cls:'sent-warn', icon:'ti-alert-circle', label:'Perhatian' };
  return { cls:'sent-warn', icon:'ti-info-circle', label:'Netral' };
}

function abbreviate(name) {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function formatSource(source, publishedAt) {
  const date = new Date(publishedAt);
  const day = date.getDate();
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
  return `${source} · ${day} ${months[date.getMonth()]}`;
}

function mapArticleToItem(article) {
  const sent = detectSentiment((article.title || '') + ' ' + (article.description || ''));
  const sourceName = article.source?.name || 'Media Indonesia';
  return {
    cat: sourceName,
    catIcon: 'ti-news',
    hl: article.title || '(tanpa judul)',
    deck: article.description || '',
    url: article.url || '#',
    src: formatSource(sourceName, article.publishedAt),
    srcIcon: 'ti-news',
    polDot: abbreviate(sourceName),
    polBg: '#0D1B2E',
    polFg: '#EEF1F5',
    polLabel: sourceName,
    sentClass: sent.cls,
    sentIcon: sent.icon,
    sentLabel: sent.label,
  };
}

async function fetchNewsFromGNews(apiKey) {
  const queries = [
    'DPR RI politisi',
    'anggota DPR Indonesia',
    'fraksi DPR Indonesia',
  ];
  const allArticles = [];

  for (const q of queries) {
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=id&country=id&max=5&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const json = await res.json();
    if (json.articles) allArticles.push(...json.articles);
  }

  // Deduplicate by URL
  const seen = new Set();
  return allArticles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  }).slice(0, 15);
}

async function commitToGitHub({ owner, repo, token, content, message }) {
  const path = 'data/news.json';
  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  // Get current SHA (needed for update)
  let sha;
  try {
    const getRes = await fetch(apiBase, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    }
  } catch { /* file doesn't exist yet, that's fine */ }

  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`GitHub commit gagal: ${putRes.status} — ${err}`);
  }
  return await putRes.json();
}

export default async function handler(req, res) {
  // Vercel cron memanggil dengan CRON_SECRET untuk verifikasi
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const GNEWS_KEY = process.env.GNEWS_API_KEY;
  const GH_TOKEN = process.env.GITHUB_TOKEN;
  const GH_OWNER = process.env.GITHUB_REPO_OWNER;
  const GH_REPO = process.env.GITHUB_REPO_NAME;

  if (!GNEWS_KEY || !GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return res.status(500).json({ error: 'Environment variables belum dikonfigurasi.' });
  }

  try {
    // 1. Fetch berita terbaru
    const articles = await fetchNewsFromGNews(GNEWS_KEY);

    if (!articles.length) {
      return res.status(200).json({ ok: true, message: 'Tidak ada berita baru ditemukan.' });
    }

    // 2. Transform ke format newsPool
    const items = articles.map(mapArticleToItem);
    const updatedAt = new Date().toISOString();
    const payload = JSON.stringify({ updatedAt, items }, null, 2);

    // 3. Commit ke GitHub → Vercel auto-deploy
    const today = new Date().toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
    await commitToGitHub({
      owner: GH_OWNER,
      repo: GH_REPO,
      token: GH_TOKEN,
      content: payload,
      message: `chore: auto-update berita ${today} [skip ci]`,
    });

    return res.status(200).json({ ok: true, count: items.length, updatedAt });
  } catch (err) {
    console.error('[daily-update]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
