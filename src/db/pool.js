import pg from 'pg';
import config from '../config.js';
import log from '../utils/logger.js';

const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
});

pool.on('error', (err) => log.error('PostgreSQL pool error:', err.message));

export default pool;
