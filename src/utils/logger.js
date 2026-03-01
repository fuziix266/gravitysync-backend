const ts = () => new Date().toISOString().substring(11, 19);

export default {
    info:  (...args) => console.log(`[${ts()}]`, ...args),
    warn:  (...args) => console.warn(`[${ts()}] ⚠️`, ...args),
    error: (...args) => console.error(`[${ts()}] 🔴`, ...args),
    db:    (...args) => console.log(`[${ts()}] 🐘`, ...args),
    ws:    (...args) => console.log(`[${ts()}] 🔌`, ...args),
    api:   (...args) => console.log(`[${ts()}] 🌐`, ...args),
};
