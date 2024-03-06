import * as vscode from 'vscode';
import { WARDuinoDebugSession } from '../DebugSession/DebugSession';
import { RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { DebuggingMode } from '../DebuggerConfig';
import { EdwardDebuggerViews } from './EdwardDebuggerViews';
import { OutOfThingsTargetDebuggerViews } from './OutOfThingsViews';
import { RemoteDebuggerViews } from './RemoteDebuggerViews';
import { RuntimeViewsRefresher } from './ViewsRefresh';
import { DevicesView } from './DevicesProvider';
import { BREAKPOINTPOLICIESVIEWCONFIG, BREAKPOINT_POLICY_PROVIDER, EVENTSVIEWCONFIG, EVENTS_PROVIDER, OOTMONITORVIEWCONFIG, PROXIESVIEWCONFIG, PROXIES_PROVIDER, SESSION_PROVIDER, STACKVIEWCONFIG, STACK_PROVIDER } from './ViewsConstants';
import { OutOfThingsLocalDebuggerViews } from './OutOfThingsLocalDebugerViews';

export class ViewsManager{

    private readonly session: WARDuinoDebugSession;
    private readonly viewMaps: Map<RemoteDebuggerBackend, RuntimeViewsRefresher>;
    private currentViews?: RuntimeViewsRefresher;
    private devicesView: DevicesView;
    private _disposables: vscode.Disposable[];


    private _sessionTreeView: vscode.TreeView<vscode.TreeItem>;

    constructor(session: WARDuinoDebugSession){
        this.session = session;
        this.devicesView = new DevicesView(session.devicesManager);
        this.viewMaps = new Map();
        this._disposables  = [];
        this.registerDataProviders();
        this._sessionTreeView = vscode.window.createTreeView(OOTMONITORVIEWCONFIG.id, {treeDataProvider: SESSION_PROVIDER});
    }

    private registerDataProviders(): void{
        this._disposables.push(vscode.window.registerTreeDataProvider(STACKVIEWCONFIG.id, STACK_PROVIDER));
        this._disposables.push(vscode.window.registerTreeDataProvider(EVENTSVIEWCONFIG.id, EVENTS_PROVIDER));
        this._disposables.push(vscode.window.registerTreeDataProvider(BREAKPOINTPOLICIESVIEWCONFIG.id, BREAKPOINT_POLICY_PROVIDER));
        this._disposables.push(vscode.window.registerTreeDataProvider(OOTMONITORVIEWCONFIG.id, SESSION_PROVIDER));
        this._disposables.push(vscode.window.registerTreeDataProvider(PROXIESVIEWCONFIG.id, PROXIES_PROVIDER));
    }

    hasView(db: RemoteDebuggerBackend): boolean{
        return this.viewMaps.has(db);
    }

    showViews(db: RemoteDebuggerBackend): void {
        const v = this.viewMaps.get(db);
        if(v === undefined){
            throw new Error('The provided RemoteDebuggerBackend has no registered views');
        }

        this.currentViews?.hideViews();
        this.currentViews = v;
        this.currentViews.showViews();
        this.devicesView.changeDeviceBeingViewed(db);
    }

    createViews(db: RemoteDebuggerBackend): void {
        if(this.hasView(db)){
            console.log('Views already created for provided RemoteDebuggerBackend');
            return;
        }

        this.devicesView.addDevice(db);

        switch (db.debuggingMode){
            case DebuggingMode.remoteDebugging:
                this.viewMaps.set(db, new RemoteDebuggerViews(this.session, db));
                break;
            case DebuggingMode.edward:
                this.viewMaps.set(db, new EdwardDebuggerViews(this.session,db));
                break;
            case DebuggingMode.outOfThings:
                if(db.isOOTDBG()){
                    this.viewMaps.set(db, new OutOfThingsLocalDebuggerViews(this.session, db));
                }else{
                    this.viewMaps.set(db, new OutOfThingsTargetDebuggerViews(this.session,db, this._sessionTreeView));
                }
                break;
            default:
                throw new Error(`Requested views for unspported debugging mode ${db.debuggingMode}`);
        }
    }
}