const crypto = require("crypto");

const apiKeyAuth = (req, res, next) => {
    const key = req.headers['x-api-key'];
    const expected = process.env.API_KEY_ESP32;

    if (!expected) {
        console.error("API_KEY_ESP32 no está configurada en el servidor");
        return res.status(500).json({ message: 'Configuración del servidor incompleta' });
    }
    if (!key) return res.status(401).json({ message: 'API Key requerida' });

    const provided = Buffer.from(String(key));
    const expectedBuffer = Buffer.from(String(expected));

    if (
        provided.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(provided, expectedBuffer)
    ) {
        return res.status(403).json({ message: 'API Key inválida' });
    }

    next();
};

module.exports = { apiKeyAuth };
