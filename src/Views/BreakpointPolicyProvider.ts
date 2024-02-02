import * as vscode from 'vscode';
import { ProviderResult, ThemeIcon, TreeItem } from 'vscode';
import { DebugBridge } from '../DebugBridges/DebugBridge';
import { BreakpointPolicy, Breakpoint } from '../State/Breakpoint';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { OldRuntimeState} from '../State/RuntimeState';
import { Context} from '../State/context';

export class BreakpointPolicyProvider implements vscode.TreeDataProvider<BreakpointPolicyItem>, RuntimeViewRefreshInterface {
    private debugBridge: DebugBridge;

    private _onDidChangeTreeData: vscode.EventEmitter<BreakpointPolicyItem | undefined | null | void> = new vscode.EventEmitter<BreakpointPolicyItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<BreakpointPolicyItem | undefined | null | void> = this._onDidChangeTreeData.event;


    private items: BreakpointPolicyItem[];


    constructor(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
        this.items = Breakpoint.policies().map(p => new BreakpointPolicyItem(p));
    }

    getChildren(element?: BreakpointPolicyItem): ProviderResult<BreakpointPolicyItem[]> {
        if (element === undefined) {
            const activePolicy = this.debugBridge.getDeviceConfig().getBreakpointPolicy();
            this.items.forEach(i => {
                if (i.getPolicy() === activePolicy) {
                    i.select();
                } else {
                    i.deSelect();
                }
            });
            return this.items;

        }
        return undefined;
    }

    getTreeItem(element: BreakpointPolicyItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    setDebugBridge(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
    }

    oldRefreshView(runtimeState?: OldRuntimeState): void {
        console.log('BreakpointPolicyprovider not calling oldRefreshView');
        // this._onDidChangeTreeData.fire();
    }

    refreshView(runtimeState: Context): void {
        console.log('TODO breakpoint policy provider');
        // this.runtimeState = runtimeState; 
        // this._onDidChangeTreeData.fire();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getSelected(): undefined | BreakpointPolicyItem {
        return this.items.find(item => item.isSelected());
    }

    toggleItem(item: BreakpointPolicyItem) {
        this.items.forEach(i => {
            if (item !== i) {
                i.deSelect();
            }
        });
        item.toggle();
    }
}

export class BreakpointPolicyItem extends vscode.TreeItem {
    private selected: boolean;
    private policy: BreakpointPolicy;

    constructor(policy: BreakpointPolicy) {
        super(policy);
        this.policy = policy;
        this.selected = false;
        this.iconPath = new ThemeIcon('pass-filled');
        this.command = { title: 'Activate breakpoint policy', command: 'warduinodebug.toggleBreakpointPolicy', arguments: [this] };
    }

    getPolicy(): BreakpointPolicy {
        return this.policy;
    }

    isSelected(): boolean {
        return this.selected;
    }

    toggle() {
        this.selected = !this.selected;
        this.iconPath = new ThemeIcon(this.selected ? 'pass-filled' : 'circle-large-outline');
    }

    select() {
        this.selected = true;
        this.iconPath = new ThemeIcon('pass-filled');
    }

    deSelect() {
        this.selected = false;
        this.iconPath = new ThemeIcon('circle-large-outline');
    }
}