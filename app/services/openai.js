const axios = require('axios');
require('dotenv').config();

// Función para analizar texto con Azure OpenAI
async function analizarTexto(texto) {
  const endpoint = process.env.OPENAI_ENDPOINT; // p. ej. https://tu-recurso.openai.azure.com/openai/deployments/mi-modelo/completions?api-version=2023-03-15-preview
  const apiKey = process.env.OPENAI_KEY;

  const headers = { 'api-key': apiKey, 'Content-Type': 'application/json' };
  const data = { prompt: texto, max_tokens: 100 };

  const response = await axios.post(endpoint, data, { headers });
  return response.data;
}

module.exports = { analizarTexto };
