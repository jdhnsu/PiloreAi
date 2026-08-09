// 离线用例注册表(确定性范围)。运行器在此收集全部离线用例。
import type { OfflineCaseDef } from "../../harness/score.js";
import { vfsCases } from "./vfs.js";
import { toolsCases } from "./tools.js";
import { personasCases } from "./personas.js";
import { sessionCases } from "./session.js";
import { execCases } from "./exec.js";
import { injectionCases } from "./injection.js";

export const offlineCases: OfflineCaseDef[] = [...vfsCases, ...toolsCases, ...personasCases, ...sessionCases, ...execCases, ...injectionCases];