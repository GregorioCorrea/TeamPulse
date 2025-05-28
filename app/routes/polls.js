const express = require('express');
const router = express.Router();
const { analizarTexto } = require('../services/openai');

// Ruta para crear una encuesta (ejemplo simple)
router.post('/crear', (req, res) => {
  const { pregunta } = req.body;
  if (!pregunta) {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }
  // Aquí guardarías la encuesta en la base de datos
  res.json({ mensaje: 'Encuesta creada' });
});

// Ruta para enviar respuestas y analizarlas
router.post('/responder', async (req, res) => {
  const { respuesta } = req.body;
  if (!respuesta) {
    return res.status(400).json({ error: 'Falta la respuesta' });
  }
  try {
    // Llamada al servicio de Azure OpenAI
    const analisis = await analizarTexto(respuesta);
    // Aquí guardarías la respuesta y el análisis
    res.json({ analisis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al analizar la respuesta' });
  }
});

module.exports = router;
