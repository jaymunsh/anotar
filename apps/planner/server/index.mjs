import { makeApp } from './app.mjs';
const app=makeApp();
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8794);
app.server.listen(port,host,()=>console.log(`anotar planner listening on ${host}:${port}`));
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
