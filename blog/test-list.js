const https = require('https');
const fs = require('fs');
const key = fs.readFileSync('../.env', 'utf8').split('\n').find(l => l.startsWith('GEMINI_API_KEY=')).split('=')[1].trim();

https.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const models = JSON.parse(data).models;
      models.forEach(m => {
        if(m.name.includes('gemini-3')) console.log(m.name, m.displayName);
      });
    } catch (e) { console.error('Parse error', e.message); }
  });
}).on('error', console.error);
