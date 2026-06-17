import * as vscode from 'vscode';

export default class Stats {
	private context: vscode.ExtensionContext;
	private statusBarItem: vscode.StatusBarItem;

	// session tracking
	private sessionStartTime: number | null = null;
	private sessionStartCount: number = 0;
	private lastEventTime: number | null = null;
	private inactivityTimer: NodeJS.Timer | undefined;

	private paused: boolean = true;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			9998
		);
		this.statusBarItem.show();
	}

	async activate() {
		this.context.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor(() => this.update()),
			vscode.workspace.onDidChangeTextDocument(e => this.onDocChange(e))
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
		if (!editor) return;
		const text = editor.document.getText();
		const count = this.countChars(text);

		if (this.lastEventTime && now - this.lastEventTime <= 5000) {
			// continue session
			if (this.sessionStartTime === null) {
				this.sessionStartTime = now;
				this.sessionStartCount = count;
			}
		} else {
			// start new session
			this.sessionStartTime = now;
			this.sessionStartCount = count;
		}
		this.lastEventTime = now;
		this.paused = false;
		this.update();

		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer);
		}
		this.inactivityTimer = setTimeout(() => {
			// pause after 5s inactivity
			this.paused = true;
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
		const total = this.countChars(text);
		const chinese = this.countChinese(text);

		let speedStr = '—';
		if (!this.paused && this.sessionStartTime && this.lastEventTime) {
			const elapsed = (this.lastEventTime - this.sessionStartTime) / 1000;
			const delta = total - this.sessionStartCount;
			if (elapsed > 0) {
				const sp = delta / elapsed; // chars per second, signed
				speedStr = `${sp >= 0 ? '+' : ''}${sp.toFixed(2)} ch/s`;
			} else {
				speedStr = '—';
			}
		}

		this.statusBarItem.text = `字数: ${total} (中文:${chinese}) | 速度: ${speedStr}`;
	}

	private countChars(text: string) {
		// remove punctuation, symbols and whitespace
		try {
			return text.replace(/[\p{P}\p{S}\s]/gu, '').length;
		} catch (e) {
			// fallback if JS engine doesn't support \p{}
			return text.replace(/[\s\pP\pS]/g, '').length;
		}
	}

	private countChinese(text: string) {
		const m = text.match(/[\u4e00-\u9fff]/g);
		return m ? m.length : 0;
	}
}
