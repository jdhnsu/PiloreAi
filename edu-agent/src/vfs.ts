/** 内存虚拟文件系统：学生工作区只存在于内存中，不落本地磁盘。 */

/** 规范化路径：统一斜杠、去掉前导 ./ 与 /、解析 . 与 .. 段，禁止逃逸出根目录。 */
export function normalizePath(path: string): string {
	const raw = path.trim().replace(/\\/g, "/");
	if (!raw) throw new Error("路径不能为空");
	const segments: string[] = [];
	for (const part of raw.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (segments.length === 0) throw new Error(`路径越界: ${path}`);
			segments.pop();
			continue;
		}
		segments.push(part);
	}
	if (segments.length === 0) throw new Error(`无效路径: ${path}`);
	return segments.join("/");
}

export class VirtualFS {
	private files = new Map<string, string>();

	write(path: string, content: string): string {
		const key = normalizePath(path);
		this.files.set(key, content);
		return key;
	}

	/** 文件不存在时抛错，由工具层转为 isError 结果让模型自我纠正。 */
	read(path: string): string {
		const key = normalizePath(path);
		const content = this.files.get(key);
		if (content === undefined) throw new Error(`文件不存在: ${key}`);
		return content;
	}

	has(path: string): boolean {
		return this.files.has(normalizePath(path));
	}

	delete(path: string): boolean {
		return this.files.delete(normalizePath(path));
	}

	list(): string[] {
		return [...this.files.keys()].sort();
	}

	/** 导出为 { 相对路径: 内容 }，用于提交给执行服务。 */
	toRecord(): Record<string, string> {
		return Object.fromEntries(this.files);
	}

	clear(): void {
		this.files.clear();
	}
}
