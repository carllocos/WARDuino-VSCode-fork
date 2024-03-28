import * as vscode from 'vscode';
import { RuntimeViewsRefresher } from './ViewsRefresh';
import { BackendDebuggerEvent, RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { WARDuinoDebugSession } from '../DebugSession/DebugSession';
import { Context} from '../State/context';
import {SourceCodeMapping, WASM} from 'wasmito';
import { StoppedEvent } from 'vscode-debugadapter';
import {EVENTSVIEWCONFIG, EVENTS_PROVIDER, STACKVIEWCONFIG, STACK_PROVIDER } from './ViewsConstants';

export class EdwardDebuggerViews extends RuntimeViewsRefresher {
    private isVisible: boolean;
    constructor(session: WARDuinoDebugSession, db: RemoteDebuggerBackend) {
        super(session, db);
        this.isVisible = false;
        this.addViewProvider(STACK_PROVIDER);
        this.addViewProvider(EVENTS_PROVIDER);
    }


    hideViews(): void {
        this.viewsVisibility(false);
    }

    close(): void {
        console.warn('RemoteDebuggerViews.close not implemented falling back to hideViews');
        this.hideViews();
    }

    showViews(): void {
        this.viewsVisibility(true);
    }

    registerViewCallbacks(): void {
        this.dbg.on(BackendDebuggerEvent.StateUpdated, (context: Context)=>{
            this.refreshViews(context);
            EVENTS_PROVIDER.refreshEvents(context.events.values);
        });
        this.dbg.on(BackendDebuggerEvent.BreakpointReached, (context: Context, location: SourceCodeMapping)=>{
            this.session.sendEvent(new StoppedEvent('breakpoint', this.session.THREAD_ID));
            this.refreshViews(context);
            EVENTS_PROVIDER.refreshEvents(context.events.values);
        });

        this.dbg.on(BackendDebuggerEvent.NewEventArrived, (ev: WASM.Event, allEvents: WASM.Event[]) => {
            EVENTS_PROVIDER.refreshEvents(allEvents);
        });
        this.dbg.on(BackendDebuggerEvent.EventHandled, (ev: WASM.Event, allEvents: WASM.Event[]) => {
            EVENTS_PROVIDER.refreshEvents(allEvents);
        });
    }

    private viewsVisibility(visible: boolean): void{
        vscode.commands.executeCommand('setContext',STACKVIEWCONFIG.when , visible);
        vscode.commands.executeCommand('setContext',EVENTSVIEWCONFIG.when , visible);
        this.isVisible = visible;
        if(visible){
            STACK_PROVIDER.setCurrentDBG(this.dbg);
        }
    }
}