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
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';


export interface DataProviderInterface<T> extends  vscode.TreeDataProvider<T>, RuntimeViewRefreshInterface{}

export class ViewsManager{

    private readonly session: WARDuinoDebugSession;
    private readonly viewMaps: Map<RemoteDebuggerBackend, RuntimeViewsRefresher>;
    private currentViews?: RuntimeViewsRefresher;
    public readonly devicesView: DevicesView;
    private _disposables: vscode.Disposable[];

    private _dataProvider: Map<string, DataProviderInterface<any>>;

    constructor(session: WARDuinoDebugSession){
        this.session = session;
        this.devicesView = new DevicesView(session.devicesManager);
        this.viewMaps = new Map();
        this._disposables  = [];
        this._dataProvider = new Map();
        this.registerDataProviders();
    }

    private registerDataProviders(): void{
        const v: Array<[string, DataProviderInterface<any>]> = [
            [STACKVIEWCONFIG.id, STACK_PROVIDER],
            [EVENTSVIEWCONFIG.id, EVENTS_PROVIDER],
            [BREAKPOINTPOLICIESVIEWCONFIG.id, BREAKPOINT_POLICY_PROVIDER],
            [OOTMONITORVIEWCONFIG.id, SESSION_PROVIDER],
            [PROXIESVIEWCONFIG.id, PROXIES_PROVIDER],
        ];
        v.forEach(([id, dp]: [string, DataProviderInterface<any>]) => {
            this.registerDataProvider(id, dp);
        });
    }

    private registerDataProvider<T>(id: string, dp: DataProviderInterface<T>): void{
        this._dataProvider.set(id, dp);
        this._disposables.push(vscode.window.registerTreeDataProvider(id, dp));
    }


    getDataProvider<T>(id: string): DataProviderInterface<T>{
        const d= this._dataProvider.get(id);
        if(d === undefined){
            throw new Error(`Data provder with id ${id} is unexisting`);
        }
        return d;
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
        this.devicesView.show();
    }

    createViews(db: RemoteDebuggerBackend, parentDBG?: RemoteDebuggerBackend): void {
        if(this.hasView(db)){
            console.log('Views already created for provided RemoteDebuggerBackend');
            return;
        }

        this.devicesView.addDevice(db, parentDBG);

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
                    this.viewMaps.set(db, new OutOfThingsTargetDebuggerViews(this.session,db));
                }
                break;
            default:
                throw new Error(`Requested views for unspported debugging mode ${db.debuggingMode}`);
        }
    }
}