// 在线用例注册表(真实模型范围)。运行器 mode=real/all 时使用。
import type { OnlineCaseDef } from "../../harness/session-driver.js";
import { routerCases } from "./router.js";
import { disciplineCases } from "./discipline.js";
import { teachingCases } from "./teaching.js";

export const onlineCases: OnlineCaseDef[] = [...routerCases, ...disciplineCases, ...teachingCases];