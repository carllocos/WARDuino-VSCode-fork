import * as vscode from 'vscode';
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { OldRuntimeState } from '../State/RuntimeState';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { Context} from '../State/context';
import { DeviceManager} from 'wasmito';
import { DEVICESVIEWCONFIG } from './ViewsConstants';
import { VIEW_DEVICE_COMMAND } from '../Commands/CommandsConstants';
import { RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';

export class DevicesView {
    private readonly _devicesProvider: DevicesProvider;
    private _disposables: vscode.Disposable[];
    private _devicesTreeView: vscode.TreeView<TreeItem>;

    constructor(dm: DeviceManager) {
        this._disposables = [];
        this._devicesProvider = new DevicesProvider();
        vscode.commands.executeCommand('setContext',DEVICESVIEWCONFIG.when , true);
        this._disposables.push(vscode.window.registerTreeDataProvider(DEVICESVIEWCONFIG.id, this._devicesProvider));
        this._devicesTreeView = vscode.window.createTreeView(DEVICESVIEWCONFIG.id, {treeDataProvider: this._devicesProvider});
    }

    show(): void {
        this._devicesProvider.refreshView();
    }

    changeDeviceBeingViewed(dbg: RemoteDebuggerBackend): void{
        this._devicesProvider.setCurrentDBG(dbg);
    }

    addDevice(device: RemoteDebuggerBackend, parentDevice?: RemoteDebuggerBackend): void{
        this._devicesProvider.createItem(device, parentDevice, this._devicesTreeView);
    }
}

export class DevicesProvider implements vscode.TreeDataProvider<DeviceItem>, RuntimeViewRefreshInterface {

    private _onDidChangeTreeData: vscode.EventEmitter<DeviceItem | undefined | null | void> = new vscode.EventEmitter<DeviceItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DeviceItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private readonly items: DeviceItem[];
    private selectedDevice?: RemoteDebuggerBackend;

    constructor() {
        this.items = [];
        this.selectedDevice = undefined;
    }

    createItem(dev: RemoteDebuggerBackend,  parent: RemoteDebuggerBackend | undefined ,view: vscode.TreeView<TreeItem>): void {
        const i = new DeviceItem(dev, view);
        const p = this.items.find((i)=>{
            return i.device === parent;
        });
        if(p !== undefined){
            i.parent = p;
            p.addChild(i);
        }
        else{
            this.items.push(i);
        }
    }

    setCurrentDBG(dbg: RemoteDebuggerBackend): void {
        this.selectedDevice = dbg;
    }

    getParent(item: DeviceItem) {
        return item.parent;
    }

    getChildren(element?: DeviceItem): ProviderResult<DeviceItem[]> {
        if (element === undefined) {
            // undefined when at the root
            return this.items;
        }
        return element.children;
    }

    getTreeItem(element: DeviceItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        if(element.device === this.selectedDevice){
            element.select();
        }
        else {
            element.deSelect();
        }
        return element;
    }


    oldRefreshView(runtimeState?: OldRuntimeState) {
        this._onDidChangeTreeData.fire();
    }

    refreshView(runtimeState?: Context) {
        this._onDidChangeTreeData.fire();
    }
}

export class DeviceItem extends vscode.TreeItem {
    public readonly device: RemoteDebuggerBackend;
    private selected: boolean;
    private view: vscode.TreeView<TreeItem>;
    public parent: DeviceItem | undefined;
    public readonly children: DeviceItem[];

    constructor(
        device: RemoteDebuggerBackend,
        view: vscode.TreeView<TreeItem>,
        treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None
    ) {
        super(device.targetVM.platform.config.deviceIdentity.name, treeItemCollapsibleState);
        this.device = device;
        this.view = view;
        this.selected  = false;
        this.command = { title: VIEW_DEVICE_COMMAND.title, command: VIEW_DEVICE_COMMAND.command, arguments: [this] };
        this.children = [];
    }

    public select() {
        this.selected = true;
        if (this.view) {
            this.view.reveal(this);
        }
    }

    public setParent(p: DeviceItem): void{
        this.parent = p;
    }

    public addChild(i: DeviceItem): void{
        this.children.push(i);
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
    }

    public deSelect() {
        this.selected = false;
    }

    public isSelected() {
        return this.selected;
    }
}


