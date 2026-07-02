const https = require('https');
const fs = require('fs');
const key = fs.readFileSync('../.env', 'utf8').split('\n').find(l => l.startsWith('NVIDIA_API_KEY=')).split('=')[1].trim();

const options = {
  hostname: 'integrate.api.nvidia.com',
  path: '/v1/models',
  headers: { 'Authorization': `Bearer ${key}` },
};

https.get(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const models = JSON.parse(data).data;
      models.forEach(m => {
        console.log(m.id);
      });
      console.log(`\n总计: ${models.length} 个模型`);
    } catch (e) { console.error('Parse error', e.message); }
  });
}).on('error', console.error);
