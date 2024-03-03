import * as vscode from 'vscode';
import { RuntimeViewsRefresher } from './ViewsRefresh';
import { BackendDebuggerEvent, RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { WARDuinoDebugSession } from '../DebugSession/DebugSession';
import { Context} from '../State/context';
import {SourceCodeMapping, WASM} from 'wasmito';
import { StoppedEvent } from 'vscode-debugadapter';
import { EVENTSVIEWCONFIG, EVENTS_PROVIDER, STACKVIEWCONFIG, STACK_PROVIDER } from './ViewsConstants';

export class RemoteDebuggerViews extends RuntimeViewsRefresher {

    private isHidden: boolean;
    constructor(session: WARDuinoDebugSession, db: RemoteDebuggerBackend) {
        super(session, db);
        this.isHidden = true;
    }


    hideViews(): void {
        vscode.commands.executeCommand('setContext',STACKVIEWCONFIG.when , false);
        vscode.commands.executeCommand('setContext',EVENTSVIEWCONFIG.when , false);
        this.isHidden = true;
    }

    close(): void {
        console.warn('RemoteDebuggerViews.close not implemented falling back to hideViews');
        this.hideViews();
    }

    showViews(): void {
        vscode.commands.executeCommand('setContext',STACKVIEWCONFIG.when , true);
        vscode.commands.executeCommand('setContext',EVENTSVIEWCONFIG.when , true);
        STACK_PROVIDER.setCurrentDBG(this.dbg);
        STACK_PROVIDER.refreshView();
        EVENTS_PROVIDER.refreshView();
        this.isHidden = false;
    }

    registerViewCallbacks(): void {
        this.dbg.on(BackendDebuggerEvent.StateUpdated, (context: Context)=>{
            if(this.isHidden){
                console.warn('the view is hidden and the callbacks should not be called?');
            }else{
                this.refreshViews(context);
                EVENTS_PROVIDER.refreshEvents(context.events.values);
            }
        });
        this.dbg.on(BackendDebuggerEvent.BreakpointReached, (context: Context, location: SourceCodeMapping)=>{
            if(this.isHidden){
                console.warn('the view is hidden and the callbacks should not be called?');
            }else{
                this.session.sendEvent(new StoppedEvent('breakpoint', this.session.THREAD_ID));
                this.refreshViews(context);
                EVENTS_PROVIDER.refreshEvents(context.events.values);
            }
        });

        this.dbg.on(BackendDebuggerEvent.NewEventArrived, (ev: WASM.Event, allEvents: WASM.Event[]) => {
            if(this.isHidden){
                console.warn('the view is hidden and the callbacks should not be called?');
            }else{
                EVENTS_PROVIDER.refreshEvents(allEvents);
            }
        });
        this.dbg.on(BackendDebuggerEvent.EventHandled, (ev: WASM.Event, allEvents: WASM.Event[]) => {
            if(this.isHidden){
                console.warn('the view is hidden and the callbacks should not be called?');
            }else{
                EVENTS_PROVIDER.refreshEvents(allEvents);
            }
        });
    }
}