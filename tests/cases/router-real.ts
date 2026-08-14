export type RouterMetric = "activation" | "nonActivation" | "stability" | "switching";

export interface RouterTurnExpectation {
	prompt: string;
	startProfile: string | null;
	endProfile: string | null;
	/** 只有计分轮进入分类指标；准备轮仍必须满足完整路由轨迹。 */
	metric?: RouterMetric;
}

export interface RouterRealCase {
	id: string;
	name: string;
	turns: RouterTurnExpectation[];
}

/**
 * 提示刻意不包含 @key 或 Profile 名称，只通过自然语言表达教学方式意图。
 * 多轮用例的第一轮用于建立稳定的初始 Profile，第二轮才衡量保持或切换。
 */
export const routerRealCases: RouterRealCase[] = [
	{
		id: "CRR-01",
		name: "抽象概念需要生活类比",
		turns: [{
			prompt: "闭包太抽象了，我完全听不懂。能不能不要堆术语，用生活里的比方和大白话讲给零基础的人？",
			startProfile: null,
			endProfile: "feynman",
			metric: "activation",
		}],
	},
	{
		id: "CRR-02",
		name: "原理与易混概念辨析",
		turns: [{
			prompt: "请把 Python 里 == 和 is 的底层原理讲透，并系统辨析它们最容易混淆的地方。",
			startProfile: null,
			endProfile: "socrates",
			metric: "activation",
		}],
	},
	{
		id: "CRR-03",
		name: "缺少前置基础需要脚手架",
		turns: [{
			prompt: "我想学 Django，但连 HTTP 都没学过，也不知道还缺哪些基础。请先帮我拆开前置知识，告诉我从哪里开始。",
			startProfile: null,
			endProfile: "oris",
			metric: "activation",
		}],
	},
	{
		id: "CRR-04",
		name: "简单语法问题不激活",
		turns: [{
			prompt: "Python 里创建一个空列表用什么语法？只给最简示例。",
			startProfile: null,
			endProfile: null,
			metric: "nonActivation",
		}],
	},
	{
		id: "CRR-05",
		name: "简单 API 事实不激活",
		turns: [{
			prompt: "pathlib.Path.exists() 返回什么类型？请直接回答。",
			startProfile: null,
			endProfile: null,
			metric: "nonActivation",
		}],
	},
	{
		id: "CRR-06",
		name: "类比方式跨主题保持",
		turns: [
			{
				prompt: "闭包太抽象了，请用生活里的比方和大白话讲，让零基础的人也能听懂。",
				startProfile: null,
				endProfile: "feynman",
			},
			{
				prompt: "沿用刚才这种生活化的讲法，再解释一下 Python 的生成器。",
				startProfile: "feynman",
				endProfile: "feynman",
				metric: "stability",
			},
		],
	},
	{
		id: "CRR-07",
		name: "原理方式跨主题保持",
		turns: [
			{
				prompt: "请讲透 Python 引用计数的工作原理，并说明循环引用为什么特殊。",
				startProfile: null,
				endProfile: "socrates",
			},
			{
				prompt: "继续沿着这种原理分析方式，讲讲浅拷贝和深拷贝为什么会有不同表现。",
				startProfile: "socrates",
				endProfile: "socrates",
				metric: "stability",
			},
		],
	},
	{
		id: "CRR-08",
		name: "补基础路径保持",
		turns: [
			{
				prompt: "我想学异步 Web 开发，但连事件循环和协程都没学过。请先梳理必须补的基础和顺序。",
				startProfile: null,
				endProfile: "oris",
			},
			{
				prompt: "先别跳到框架代码，继续按这个顺序把下一项必需的基础补上。",
				startProfile: "oris",
				endProfile: "oris",
				metric: "stability",
			},
		],
	},
	{
		id: "CRR-09",
		name: "基础补齐后切到原理辨析",
		turns: [
			{
				prompt: "我想学 Django，但 HTTP 基础还没学过。先帮我拆开前置知识并安排学习顺序。",
				startProfile: null,
				endProfile: "oris",
			},
			{
				prompt: "这些前置我已经明白了。现在请把 HTTP 无状态的原理讲透，并辨析 Cookie 和 Session 容易混淆的地方。",
				startProfile: "oris",
				endProfile: "socrates",
				metric: "switching",
			},
		],
	},
	{
		id: "CRR-10",
		name: "原理太抽象后切到类比",
		turns: [
			{
				prompt: "请系统讲透 Python 闭包的词法作用域原理，以及自由变量是怎样被保存的。",
				startProfile: null,
				endProfile: "socrates",
			},
			{
				prompt: "还是太抽象了。不要再讲术语，换成生活里的比方，用大白话重新解释。",
				startProfile: "socrates",
				endProfile: "feynman",
				metric: "switching",
			},
		],
	},
	{
		id: "CRR-11",
		name: "专门讲解后交还简单问答",
		turns: [
			{
				prompt: "闭包太抽象了，请用生活里的比方和大白话解释给零基础的人。",
				startProfile: null,
				endProfile: "feynman",
			},
			{
				prompt: "明白了。顺便告诉我 Python 空字典怎么写，只给一行答案。",
				startProfile: "feynman",
				endProfile: null,
				metric: "switching",
			},
		],
	},
];
