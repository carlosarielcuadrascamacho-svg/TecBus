const apiKeyAuth = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ message: 'API Key requerida' });
    if (key !== process.env.API_KEY_ESP32) return res.status(403).json({ message: 'API Key inválida' });
    next();
};

module.exports = { apiKeyAuth };
