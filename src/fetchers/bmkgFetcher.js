async function fetchBMKG() {
  const url = 'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json';
  const response = await fetch(url);
  const data = await response.json();
  
  if (!data.Infogempa || !data.Infogempa.gempa) {
    throw new Error('Format data BMKG tidak sesuai');
  }

  return data.Infogempa.gempa.map(g => {
    const [lat, lon] = g.Coordinates.split(',');
    
    return {
      title: `Gempa M${g.Magnitude} - ${g.Wilayah}`,
      link: `${g.DateTime}-${g.Coordinates}`,
      source: 'BMKG',
      category: 'bencana',
      published: new Date(g.DateTime).toISOString(),
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      summary: `Gempa berkekuatan M${g.Magnitude} terjadi di ${g.Wilayah} dengan kedalaman ${g.Kedalaman}.`
    };
  });
}

module.exports = { fetchBMKG };
