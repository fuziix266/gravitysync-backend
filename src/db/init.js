import pool from './pool.js';
import log from '../utils/logger.js';

/**
 * Auto-crear tablas al arrancar (patrón Mattermost: schema auto-migration).
 * Usa sequence `chat_seq` para ordering global (patrón Mattermost sequence number).
 */
export async function initDB() {
    try {
        // Sequence global para ordering (patrón Mattermost)
        await pool.query(`CREATE SEQUENCE IF NOT EXISTS chat_seq START 1`);

        // Crear tabla si no existe (fresh install)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id         SERIAL PRIMARY KEY,
                seq        BIGINT UNIQUE NOT NULL DEFAULT nextval('chat_seq'),
                uuid       VARCHAR(128) UNIQUE NOT NULL,
                session_id VARCHAR(64) NOT NULL,
                section_type VARCHAR(16) NOT NULL,
                text       TEXT NOT NULL,
                has_code   BOOLEAN DEFAULT FALSE,
                buttons    JSONB DEFAULT '[]',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Migración: agregar columna seq si la tabla ya existía (schema viejo)
        const seqCheck = await pool.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = 'chat_messages' AND column_name = 'seq'`
        );
        if (seqCheck.rows.length === 0) {
            log.db('Migrando: agregando columna seq a chat_messages...');
            await pool.query(`ALTER TABLE chat_messages ADD COLUMN seq BIGINT UNIQUE DEFAULT nextval('chat_seq')`);
            // Backfill seq basado en id para mensajes existentes
            await pool.query(`UPDATE chat_messages SET seq = id WHERE seq IS NULL`);
            log.db('Migración de seq completada');
        }

        // Índices para queries eficientes
        await pool.query('CREATE INDEX IF NOT EXISTS idx_msg_session_seq ON chat_messages(session_id, seq)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_msg_uuid ON chat_messages(uuid)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_msg_seq ON chat_messages(seq)');

        // Tabla de sesiones
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                session_id  VARCHAR(64) PRIMARY KEY,
                title       VARCHAR(256) DEFAULT '',
                last_seq    BIGINT DEFAULT 0,
                message_count INT DEFAULT 0,
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        const r = await pool.query('SELECT NOW()');
        log.db(`PostgreSQL OK — tablas listas — ${r.rows[0].now}`);
    } catch (e) {
        log.error('No se pudo inicializar PostgreSQL:', e.message);
        throw e;
    }
}
