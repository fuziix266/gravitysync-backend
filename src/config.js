import dotenv from 'dotenv';
dotenv.config();

export default {
    port: parseInt(process.env.PORT || '3000'),
    databaseUrl: process.env.DATABASE_URL || 'postgresql://user:Admin%40123@62.146.181.70:1313/gravitychat',
    nodeEnv: process.env.NODE_ENV || 'development',
    // Tipos de sección que se pushean a Flutter (Mattermost: solo contenido visible)
    pushableTypes: new Set(['user', 'response', 'code']),
    // Tipos filtrados (nunca se envían al cliente en real-time)
    filteredTypes: new Set(['thinking', 'status']),
};
