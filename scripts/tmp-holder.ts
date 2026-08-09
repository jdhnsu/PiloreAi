import { createServer } from "node:http";

const s = createServer(() => {});
s.listen(8600, () => console.log("[holder] 占用 8600"));
setInterval(() => {}, 60000);
