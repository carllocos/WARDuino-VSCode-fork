import * as vscode from 'vscode';

import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { Context} from '../State/context';
import { RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { WARDuinoDebugSession } from '../DebugSession/DebugSession';

export abstract class RuntimeViewsRefresher {

    protected viewsProviders: RuntimeViewRefreshInterface[]; // todo delete?
    protected readonly session: WARDuinoDebugSession;
    protected readonly dbg: RemoteDebuggerBackend;

    constructor(session: WARDuinoDebugSession, db: RemoteDebuggerBackend) {
        this.session = session;
        this.dbg = db;
        this.viewsProviders = [];
        this.registerViewCallbacks();
    }

    addViewProvider(viewProvider: RuntimeViewRefreshInterface) {
        this.viewsProviders.push(viewProvider);
    }

    refreshViews(context?: Context) {
        this.viewsProviders.forEach(v => {
            v.refreshView(context);
        });
    }

    abstract hideViews(): void;

    abstract close(): void;

    abstract showViews(): void ;

    abstract registerViewCallbacks(): void ;

}