require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function simpanBerita(daftarBerita) {
  const data = daftarBerita.map(berita => ({
    title: berita.title,
    link: berita.link,
    source: berita.source,
    category: berita.category,
    pub_date: berita.published,
    fetched_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('articles')
    .upsert(data, { onConflict: 'link', ignoreDuplicates: true });

  if (error) throw error;
}

async function ambilBerita() {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .order('impact_score', { ascending: false, nullsLast: true })
    .order('pub_date', { ascending: false });

  if (error) throw error;
  return data;
}

module.exports = { simpanBerita, ambilBerita };
