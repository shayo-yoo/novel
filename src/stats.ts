import * as vscode from 'vscode';

// 速度显示模式
type SpeedMode = 'hour' | 'minute';
// 字数显示模式
type CharCountMode = 'total' | 'chinese' | 'nonAscii';

export default class Stats {
	private context: vscode.ExtensionContext;
	private statusBarItem: vscode.StatusBarItem;

	// 写作会话计时
	// writingStartTime: 本次写作开始时间戳（第一次输入时设置，冻结后不重置）
	private writingStartTime: number | null = null;
	// accumulatedWritingTime: 之前已完成的写作时长累计（毫秒）
	private accumulatedWritingTime: number = 0;

	// 当前活跃 session 计时
	private sessionStartTime: number | null = null;
	private lastEventTime: number | null = null;
	private inactivityTimer: NodeJS.Timer | undefined;

	// 5秒无输入后冻结（停止计时和速度更新），保留最后值
	private frozen: boolean = true;
	private frozenSpeed: number = 0;
	private frozenTotalTime: number = 0; // 冻结时的总写作时长(ms)，用于冻结状态下显示

	// 当前显示模式
	private speedMode: SpeedMode = 'hour';
	private charCountMode: CharCountMode = 'total';

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			9998
		);
		this.statusBarItem.show();

		// 从配置读取模式
		this.speedMode = vscode.workspace
			.getConfiguration('novel')
			.get<SpeedMode>('speedMode', 'hour');
		this.charCountMode = vscode.workspace
			.getConfiguration('novel')
			.get<CharCountMode>('charCountMode', 'total');
	}

	async activate() {
		this.context.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor(() => this.update()),
			vscode.workspace.onDidChangeTextDocument(e => this.onDocChange(e)),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('novel.speedMode')) {
					this.speedMode = vscode.workspace
						.getConfiguration('novel')
						.get<SpeedMode>('speedMode', 'hour');
					this.update();
				}
				if (e.affectsConfiguration('novel.charCountMode')) {
					this.charCountMode = vscode.workspace
						.getConfiguration('novel')
						.get<CharCountMode>('charCountMode', 'total');
					this.update();
				}
			}),
			// 切换速度模式命令
			vscode.commands.registerCommand('novel.toggleSpeedMode', () => {
				this.toggleSpeedMode();
			}),
			// 切换字数模式命令
			vscode.commands.registerCommand('novel.toggleCharCountMode', () => {
				this.toggleCharCountMode();
			})
		);
		this.update();
	}

	onDocChange(e: vscode.TextDocumentChangeEvent) {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'novel') {
			return;
		}
		if (e.document !== editor.document) {
			return;
		}
		this.handleActivity();
	}

	private handleActivity() {
		const now = Date.now();
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		if (this.lastEventTime && now - this.lastEventTime <= 5000) {
			// 5秒内有输入：继续当前 session
			if (this.writingStartTime === null) {
				// 第一次开始写作
				this.writingStartTime = now;
				this.accumulatedWritingTime = 0;
			}
			if (this.sessionStartTime === null) {
				// 从冻结状态恢复
				this.sessionStartTime = now;
			}
		} else {
			// 5秒以上无输入：开始新 session
			if (this.writingStartTime === null) {
				this.writingStartTime = now;
				this.accumulatedWritingTime = 0;
			}
			// 如果没有冻结就把上一个 session 的时长累加
			if (!this.frozen && this.sessionStartTime && this.lastEventTime) {
				this.accumulatedWritingTime += this.lastEventTime - this.sessionStartTime;
			}
			this.sessionStartTime = now;
		}
		this.lastEventTime = now;
		this.frozen = false;
		this.update();

		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer);
		}
		this.inactivityTimer = setTimeout(() => {
			// 5秒无输入：冻结，把当前 session 时长累加
			if (this.sessionStartTime && this.lastEventTime) {
				this.accumulatedWritingTime += this.lastEventTime - this.sessionStartTime;
			}

			const editor2 = vscode.window.activeTextEditor;
			if (editor2) {
				const text = editor2.document.getText();
				const count = this.getCharCount(text);
				const totalTime = this.accumulatedWritingTime;
				if (totalTime > 0) {
					this.frozenSpeed = count / (totalTime / 1000); // chars per second
				}
				this.frozenTotalTime = totalTime;
			}
			this.frozen = true;
			this.sessionStartTime = null;
			this.lastEventTime = null;
			this.update();
		}, 5000);
	}

	private update() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'novel') {
			this.statusBarItem.text = '';
			return;
		}
		const text = editor.document.getText();
		const total = this.getCharCount(text);

		// 计算总写作时长(ms)
		let totalWritingTime: number;
		if (this.frozen) {
			totalWritingTime = this.frozenTotalTime;
		} else if (this.sessionStartTime && this.lastEventTime) {
			totalWritingTime =
				this.accumulatedWritingTime +
				(this.lastEventTime - this.sessionStartTime);
		} else {
			totalWritingTime = this.accumulatedWritingTime;
		}

		// 格式化速度：根据总字数 / 总写作时长
		let speedStr = '—';
		if (totalWritingTime > 0) {
			const charsPerSecond = total / (totalWritingTime / 1000);
			speedStr = this.formatSpeed(charsPerSecond);
		}

		// 格式化写作时长
		const timeStr = this.formatTime(totalWritingTime);

		const modeLabel = this.getModeLabel();
		const speedUnitLabel = this.speedMode === 'hour' ? '时' : '分';
		this.statusBarItem.text = `$(keyboard) ${total}${modeLabel} | ${speedStr} 字/${speedUnitLabel} | ${timeStr}`;
	}

	/** 格式化毫秒为可读时间 */
	private formatTime(ms: number): string {
		if (ms <= 0) {
			return '00:00';
		}
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		if (hours > 0) {
			return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
		}
		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}

	/** 根据当前模式获取字数 */
	private getCharCount(text: string): number {
		switch (this.charCountMode) {
			case 'total':
				// 全部字符数（每个空格、符号、中文都算入）
				return text.length;
			case 'chinese':
				// 中文字符数
				return this.countChinese(text);
			case 'nonAscii':
				// 非ASCII码位数
				return this.countNonAscii(text);
			default:
				return text.length;
		}
	}

	/** 模式标签：用于状态栏显示 */
	private getModeLabel(): string {
		switch (this.charCountMode) {
			case 'total':
				return '字';
			case 'chinese':
				return '中';
			case 'nonAscii':
				return '符';
			default:
				return '字';
		}
	}

	/** 格式化速度：从 chars/s 转为 字/时 或 字/分 */
	private formatSpeed(charsPerSecond: number): string {
		const prefix = charsPerSecond >= 0 ? '' : '';
		if (this.speedMode === 'hour') {
			const perHour = charsPerSecond * 3600;
			if (Math.abs(perHour) >= 10000) {
				return `${prefix}${(perHour / 10000).toFixed(1)}万`;
			}
			return `${prefix}${perHour.toFixed(0)}`;
		} else {
			const perMinute = charsPerSecond * 60;
			return `${prefix}${perMinute.toFixed(1)}`;
		}
	}

	/** 切换速度模式：时/分 */
	private toggleSpeedMode() {
		this.speedMode = this.speedMode === 'hour' ? 'minute' : 'hour';
		vscode.workspace
			.getConfiguration('novel')
			.update('speedMode', this.speedMode, true);
		const label = this.speedMode === 'hour' ? '时' : '分';
		vscode.window.showInformationMessage(`速度模式已切换为: 字/${label}`);
		this.update();
	}

	/** 切换字数模式：字符数/中文数/非ASCII码位数 */
	private toggleCharCountMode() {
		const modes: CharCountMode[] = ['total', 'chinese', 'nonAscii'];
		const currentIdx = modes.indexOf(this.charCountMode);
		const nextIdx = (currentIdx + 1) % modes.length;
		this.charCountMode = modes[nextIdx];
		vscode.workspace
			.getConfiguration('novel')
			.update('charCountMode', this.charCountMode, true);
		const labels: Record<CharCountMode, string> = {
			total: '字符数（全部字符）',
			chinese: '中文数',
			nonAscii: '非ASCII码位数'
		};
		vscode.window.showInformationMessage(
			`字数模式已切换为: ${labels[this.charCountMode]}`
		);
		this.update();
	}

	/* ---------- 字数统计方法 ---------- */

	/** 中文字符数 */
	private countChinese(text: string): number {
		const m = text.match(/[\u4e00-\u9fff]/g);
		return m ? m.length : 0;
	}

	/** 非ASCII码位数 */
	private countNonAscii(text: string): number {
		let count = 0;
		for (let i = 0; i < text.length; i++) {
			if (text.charCodeAt(i) > 127) {
				count++;
			}
		}
		return count;
	}
}