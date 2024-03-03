
import * as vscode from 'vscode';
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { Context} from '../State/context';
import { OldRuntimeState } from '../State/RuntimeState';
import { OutOfThingsMonitor } from 'wasmito';
import { START_DEBUGGING_COMMAND } from '../Commands/CommandsConstants';
import { RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';

export enum AllowedAction {
    debugExternally = 'debug-externally',
}

export class OutOfThingsSessionProvider implements vscode.TreeDataProvider<OutOfThingsSessionItem>, RuntimeViewRefreshInterface {

    private _onDidChangeTreeData: vscode.EventEmitter<OutOfThingsSessionItem | undefined | null | void> = new vscode.EventEmitter<OutOfThingsSessionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<OutOfThingsSessionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private items: OutOfThingsSessionItem[];
    private dbg?: RemoteDebuggerBackend;

    constructor() {
        this.items = [];
    }

    setCurrentDBG(dbg: RemoteDebuggerBackend): void {
        this.dbg = dbg;
    }

    createItemForSnapshot(monitor: OutOfThingsMonitor, snapshot: Context, view: vscode.TreeView<vscode.TreeItem>): OutOfThingsSessionItem {
        const sl = snapshot.getCurrentSourceCodeLocation();
        let label = 'snapshot';
        if(sl !== undefined){
            label += ` line nr ${sl.linenr} col start ${sl.columnStart}`;
        }
        const idx = this.items.length;
        const item =  new OutOfThingsSessionItem(monitor, label, snapshot, idx, view);
        this.items.push(item);
        return item;
    }

    oldRefreshView(runtimeState?: OldRuntimeState | undefined): void {
        throw new Error('Method not implemented.');
    }
    refreshView(runtimeState?: Context | undefined): void {
        this._onDidChangeTreeData.fire();
    }


    getParent?(element: OutOfThingsSessionItem): vscode.ProviderResult<OutOfThingsSessionItem> {
        return undefined;
    }

    getChildren(element?: OutOfThingsSessionItem): ProviderResult<OutOfThingsSessionItem[]> {
        if (element === undefined) {
            return this.items;
        }
        return undefined;
    }

    getTreeItem(element: OutOfThingsSessionItem): TreeItem | Thenable<TreeItem> {
        return element;
    }
}

export class OutOfThingsSessionItem extends vscode.TreeItem {
    public readonly snapshot: Context;
    public readonly index: number;
    public readonly monitor: OutOfThingsMonitor;
    private selected: boolean;
    private view: vscode.TreeView<TreeItem>;

    constructor(
        monitor: OutOfThingsMonitor,
        sessionlabel: string,
        snapshot: Context,
        timelineIndex: number,
        view: vscode.TreeView<TreeItem>,
        treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None
    ) {
        super(sessionlabel, treeItemCollapsibleState);
        this.monitor = monitor;
        this.snapshot = snapshot;
        this.index = timelineIndex;
        this.selected = false;
        this.contextValue = AllowedAction.debugExternally;
        this.view = view;
        this.command = { title: START_DEBUGGING_COMMAND.title, command: START_DEBUGGING_COMMAND.command, arguments: [this] };
        if(true){
        // if (snapshot.hasException()) {
            this.iconPath = new vscode.ThemeIcon('bug');
        }
    }

    public select() {
        this.selected = true;
        if (this.view) {
            this.view.reveal(this);
        }
    }

    public deSelect() {
        this.selected = false;
    }

    public toggle() {
        this.selected = !this.selected;
    }

    public isSelected() {
        return this.selected;
    }

}