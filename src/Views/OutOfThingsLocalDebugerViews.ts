import * as vscode from 'vscode';
import { WARDuinoDebugSession } from '../DebugSession/DebugSession';
import { BackendDebuggerEvent, RemoteDebuggerBackend } from '../DebugSession/DebuggerBackend';
import { RuntimeViewsRefresher } from './ViewsRefresh';
import { EVENTSVIEWCONFIG, EVENTS_PROVIDER, PROXIESVIEWCONFIG, PROXIES_PROVIDER, STACKVIEWCONFIG, STACK_PROVIDER, ViewsConfig } from './ViewsConstants';
import { Context } from '../State/context';
import {SourceCodeMapping, WASM} from 'wasmito';
import { StoppedEvent } from 'vscode-debugadapter';

export class OutOfThingsLocalDebuggerViews extends RuntimeViewsRefresher {
    private isHidden: boolean;
    private views: ViewsConfig[];

    constructor(session: WARDuinoDebugSession, db: RemoteDebuggerBackend) {
        super(session, db);
        this.views =[];
        this.isHidden = true;
        this.addView(STACKVIEWCONFIG);
        this.addView(EVENTSVIEWCONFIG);
        this.addView(PROXIESVIEWCONFIG);

        this.addViewProvider(STACK_PROVIDER);
        this.addViewProvider(PROXIES_PROVIDER);
        this.addViewProvider(EVENTS_PROVIDER);
    }

    private addView(v: ViewsConfig): void{
        this.views.push(v);
    }

    hideViews(): void {
        this.views.forEach((v)=>{
            vscode.commands.executeCommand('setContext',v.when , false);
        });
        this.isHidden = true;
    }

    close(): void {
        console.warn('OutOfThingsLocalDebuggerViews.close not implemented falling back to hideViews');
        this.hideViews();
    }

    showViews(): void {
        this.isHidden = false;
        this.views.forEach((v)=>{
            vscode.commands.executeCommand('setContext',v.when , true);
        });
        this.viewsProviders.forEach((v)=>{
            v.setCurrentDBG(this.dbg);
        });
        this.viewsProviders.forEach((v)=>{
            v.refreshView();
        });
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