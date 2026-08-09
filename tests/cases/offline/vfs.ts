// 离线用例之一:VFS / normalizePath 边界(见 TEST-SPEC OVF-01/02)。
import { normalizePath, VirtualFS } from "../../../src/index.js";
import type { OfflineCaseDef } from "../../harness/score.js";

export const vfsCases: OfflineCaseDef[] = [
	{
		id: "OVF-01",
		name: "normalizePath 规范化与越界",
		dimension: "边界",
		weight: 2,
		run: async (ctx) => {
			const normalize = (p: string) => {
				try {
					return { ok: true, value: normalizePath(p) };
				} catch (err) {
					return { ok: false, value: err instanceof Error ? err.message : String(err) };
				}
			};

			// 合法归一
			ctx.check("去空格", normalize(" a/b ").ok && normalize(" a/b ").value === "a/b");
			ctx.check("反斜杠归一", normalize("a\\b").value === "a/b");
			ctx.check("重复斜杠", normalize("//a//b//").value === "a/b");
			ctx.check("前导 .", normalize("./a").value === "a");
			ctx.check("中间 .", normalize("a/./b").value === "a/b");
			ctx.check("内部 ..", normalize("a/../b").value === "b");
			// 越界
			ctx.check("根级 .. 越界", !normalize("../x").ok, normalize("../x").value);
			ctx.check("多级 .. 越界", !normalize("a/../../x").ok, normalize("a/../../x").value);
			// 空输入
			ctx.check("空串", !normalize("").ok, normalize("").value || "no error");
		},
	},
	{
		id: "OVF-02",
		name: "VirtualFS 读写清空",
		dimension: "边界",
		weight: 1,
		run: async (ctx) => {
			const vfs = new VirtualFS();
			vfs.write("main.py", "print('hi')");
			ctx.check("has", vfs.has("main.py"));
			ctx.check("read 内容", vfs.read("main.py") === "print('hi')");
			ctx.check("list 内容", JSON.stringify(vfs.list()) === JSON.stringify(["main.py"]));
			// read 缺失
			let readMissing = false;
			try {
				vfs.read("nope.py");
			} catch {
				readMissing = true;
			}
			ctx.check("read 缺失抛错", readMissing);
			// delete / clear
			ctx.check("delete 返回布尔", vfs.delete("main.py") === true);
			vfs.write("a.ts", "x");
			vfs.clear();
			ctx.check("clear 后为空", vfs.list().length === 0);
		},
	},
];