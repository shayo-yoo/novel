import * as vscode from 'vscode';
import Highlight from './highlight';
import Gpt from './gpt';
import Format from './format/format';
import Hover from './hover';
import Stats from './stats';

export async function activate(context: vscode.ExtensionContext) {
	await new Gpt(context).activate();
	await new Highlight(context).activate();
	await new Format(context).activate();
	await new Hover(context).activate();
	await new Stats(context).activate();
}
