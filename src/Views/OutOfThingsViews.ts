import * as vscode from 'vscode';
import { RuntimeViewsRefresher } from './ViewsRefresh';
import { BackendDebuggerEvent, RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { WARDuinoDebugSession } from '../DebugSession/DebugSession';
import { Context} from '../State/context';
import {BreakpointDefaultPolicy, SourceCodeMapping, WASM, WasmState} from 'wasmito';
import { StoppedEvent } from 'vscode-debugadapter';
import { BREAKPOINTPOLICIESVIEWCONFIG, BREAKPOINT_POLICY_PROVIDER, EVENTSVIEWCONFIG, EVENTS_PROVIDER, OOTMONITORVIEWCONFIG, PROXIESVIEWCONFIG, SESSION_PROVIDER, STACKVIEWCONFIG } from './ViewsConstants';

export class OutOfThingsTargetDebuggerViews extends RuntimeViewsRefresher {

    constructor(session: WARDuinoDebugSession, dbg: RemoteDebuggerBackend) {
        super(session, dbg);
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
        BREAKPOINT_POLICY_PROVIDER.setCurrentDBG(this.dbg);
    }


    registerViewCallbacks(): void {
        this.dbg.on(BackendDebuggerEvent.StateUpdated, (context: Context)=>{
            this.refreshViews(context);
            EVENTS_PROVIDER.refreshEvents(context.events.values);
        });
        this.dbg.on(BackendDebuggerEvent.BreakpointReached, (context: Context, location: SourceCodeMapping)=>{
            if(this.dbg.targetVM.breakpointPolicy instanceof BreakpointDefaultPolicy){
                this.session.sendEvent(new StoppedEvent('breakpoint', this.session.THREAD_ID));
            }
            this.refreshViews(context);
            EVENTS_PROVIDER.refreshEvents(context.events.values);
        });

        this.dbg.on(BackendDebuggerEvent.NewEventArrived, (ev: WASM.Event, allEvents: WASM.Event[]) => {
            EVENTS_PROVIDER.refreshEvents(allEvents);
        });
        this.dbg.on(BackendDebuggerEvent.EventHandled, (ev: WASM.Event, allEvents: WASM.Event[]) => {
            EVENTS_PROVIDER.refreshEvents(allEvents);
        });

        this.dbg.monitor.subscribeOnSnapshot((state: WasmState)=>{
            const snapshot = new Context(state, this.dbg.getSourceMap());
            SESSION_PROVIDER.createItemForSnapshot(this.dbg, this.dbg.monitor, snapshot);
            SESSION_PROVIDER.refreshView();
        });
    }

    private viewsVisibility(visible: boolean): void{
        vscode.commands.executeCommand('setContext',STACKVIEWCONFIG.when , visible);
        vscode.commands.executeCommand('setContext',EVENTSVIEWCONFIG.when , visible);
        vscode.commands.executeCommand('setContext',BREAKPOINTPOLICIESVIEWCONFIG.when , visible);
        vscode.commands.executeCommand('setContext',OOTMONITORVIEWCONFIG.when , visible);
    }
}
