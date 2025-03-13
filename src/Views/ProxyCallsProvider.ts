import * as vscode from 'vscode';
import { ProviderResult, ThemeIcon, TreeItem } from 'vscode';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { OldRuntimeState} from '../State/RuntimeState';
import { Context} from '../State/context';
import { RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { WASMFunction } from 'wasmito';

export class ProxyCallsProvider implements vscode.TreeDataProvider<ProxyCallItem>, RuntimeViewRefreshInterface {
    private _onDidChangeTreeData: vscode.EventEmitter<ProxyCallItem | undefined | null | void> = new vscode.EventEmitter<ProxyCallItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProxyCallItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private dbg?: RemoteDebuggerBackend;

    private items: ProxyCallItem[];
    constructor(){
        this.items = [];
    }
    
    setCurrentDBG(dbg: RemoteDebuggerBackend): void {
        this.dbg = dbg;
        this.items = dbg.getLanguageAdaptor().sourceMap.wasm.importFuncs.map(f =>{
            return new ProxyCallItem(dbg, f, this);
        });
    }

    getChildren(element?: ProxyCallItem): ProviderResult<ProxyCallItem[]> {
        if (element === undefined) {
            return  this.items.map((i)=>{
                if(this.dbg?.targetVM.functionsProxied().has(i.func)){
                    i.select();
                }else{
                    i.deSelect();
                }
                return i;
            });
        }
        return undefined;
    }

    getTreeItem(element: ProxyCallItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    oldRefreshView(runtimeState?: OldRuntimeState) {
        console.log('TODO remove oldRefrehsView');
        // this._onDidChangeTreeData.fire();
    }

    refreshView(runtimeState?: Context): void {
        console.log('TODO refrehsView Proxies');
        // this.runtimeState = runtimeState; 
        this._onDidChangeTreeData.fire();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

export class ProxyCallItem extends vscode.TreeItem {
    private selected: boolean = true;
    public readonly func: WASMFunction;
    public index;
    public readonly dbg: RemoteDebuggerBackend;
    public readonly provider: ProxyCallsProvider;

    constructor(dbg: RemoteDebuggerBackend, func: WASMFunction, prov: ProxyCallsProvider) {
        super(func.name);
        this.dbg = dbg;
        this.provider = prov;
        this.func = func;
        this.iconPath = new ThemeIcon('pass-filled');
        this.command = { title: 'Toggle callback', command: 'warduinodebug.toggleCallback', arguments: [this] };
        this.index = func.id;
    }

    isSelected(): boolean {
        return this.selected;
    }

    select(): void{
        this.selected = true;
        this.iconPath = new ThemeIcon('pass-filled');
    }

    deSelect(): void{
        this.selected = false;
        this.iconPath = new ThemeIcon('circle-large-outline');
    }

    toggle() {
        this.selected = !this.selected;
        this.iconPath = new ThemeIcon(this.selected ? 'pass-filled' : 'circle-large-outline');
    }
}
