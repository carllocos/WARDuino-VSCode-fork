import * as vscode from 'vscode';
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { OldRuntimeState} from '../State/RuntimeState';
import { WASM, WASMValueIndexed } from 'wasmito';
import { Context} from '../State/context';
import { RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';

export class StackProvider implements vscode.TreeDataProvider<StackItem>, RuntimeViewRefreshInterface {
    private _onDidChangeTreeData: vscode.EventEmitter<StackItem | undefined | null | void> = new vscode.EventEmitter<StackItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StackItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private dbg?:RemoteDebuggerBackend;

    getChildren(element?: StackItem): ProviderResult<StackItem[]> {
        if (element === undefined || element.collapsibleState !== TreeItemCollapsibleState.None) {
            const stack = this.dbg?.getCurrentContext().stack.values.map((v: WASMValueIndexed) => {
                const _type = WASM.typeToString(v.type);
                if(_type === undefined){
                    throw new Error(`Stack provider received an unknown wasm value type ${_type}`);
                }
                return new StackItem(v.value, v.idx, _type);
            }).reverse();
            return stack ?? [];
        }
        return undefined;
    }

    setCurrentDBG(dbg: RemoteDebuggerBackend): void{
        this.dbg = dbg;
    }

    getTreeItem(element: StackItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    oldRefreshView(runtimeState?: OldRuntimeState): void {
        console.log('StackProvider not calling oldRefreshView');
        // this._onDidChangeTreeData.fir
    }

    refreshView(runtimeState?: Context): void {
        if(runtimeState !== undefined){
            throw Error('Should not update runtimeState');
            // this.runtimeState = runtimeState; 
        }
        this._onDidChangeTreeData.fire();
    }
}

export class StackItem extends vscode.TreeItem {
    constructor(value: number, idx: number, type: string, treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        const label = `Value${idx} (${type}): ${value}`;
        super(label, treeItemCollapsibleState);
    }
}