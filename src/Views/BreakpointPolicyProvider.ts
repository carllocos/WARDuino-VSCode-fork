import * as vscode from 'vscode';
import { ProviderResult, ThemeIcon, TreeItem } from 'vscode';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { OldRuntimeState} from '../State/RuntimeState';
import { Context} from '../State/context';
import { RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { BreakpointDefaultPolicy, BreakpointPolicy, RemoveAndProceedBreakpointPolicy, SingleStopBreakpointPolicy } from 'wasmito';

const policies: Array<[string, typeof BreakpointPolicy]> = 
    [['default', BreakpointDefaultPolicy],
        ['single stop', SingleStopBreakpointPolicy],
        ['remove and proceed', RemoveAndProceedBreakpointPolicy]
    ];



export class BreakpointPolicyProvider implements vscode.TreeDataProvider<BreakpointPolicyItem>, RuntimeViewRefreshInterface {
    private _onDidChangeTreeData: vscode.EventEmitter<BreakpointPolicyItem | undefined | null | void> = new vscode.EventEmitter<BreakpointPolicyItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<BreakpointPolicyItem | undefined | null | void> = this._onDidChangeTreeData.event;


    private items: BreakpointPolicyItem[];
    private dbg?: RemoteDebuggerBackend;

    constructor() {
        this.items = [];
        for (const [policyStr, policyConstructor] of policies) {
            this.items.push(new BreakpointPolicyItem(policyConstructor, policyStr));
        }
    }

    setCurrentDBG(dbg: RemoteDebuggerBackend): void{
        this.dbg = dbg;
    }

    getChildren(element?: BreakpointPolicyItem): ProviderResult<BreakpointPolicyItem[]> {
        if (element === undefined) {
            const activePolicy = this.dbg?.monitor.breakpointPolicy;
            this.items.forEach(i => {
                if(i.equals(activePolicy)){
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
    private policyName: string;
    private policy: typeof BreakpointPolicy;

    constructor(policy: typeof BreakpointPolicy, policyName: string) {
        super(policyName);
        this.policy = policy;
        this.policyName = policyName;
        this.selected = false;
        this.iconPath = new ThemeIcon('pass-filled');
        this.command = { title: 'Activate breakpoint policy', command: 'warduinodebug.toggleBreakpointPolicy', arguments: [this] };
    }

    equals(other: any): boolean {
        return other instanceof this.policy;
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