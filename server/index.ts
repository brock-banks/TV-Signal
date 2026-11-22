import { createApp } from './app.ts';
const service=createApp();const port=Number(process.env.PORT||3000),host=process.env.HOST||'0.0.0.0';
const server=service.app.listen(port,host,()=>console.log(`LAN Signage running on ${host}:${port}. Admin: http://localhost:${port}/admin/ | Compatibility: http://localhost:${port}/compat`));
function shutdown(){server.close(()=>{service.close();process.exit(0);});setTimeout(()=>process.exit(0),10000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
