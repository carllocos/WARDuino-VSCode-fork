import * as vscode from 'vscode';
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { OldRuntimeState } from '../State/RuntimeState';
import { WASM } from 'wasmito';
import { Context} from '../State/context';

export class EventsProvider implements vscode.TreeDataProvider<EventItem>, RuntimeViewRefreshInterface {
    private events: EventItem[] = [];

    private _onDidChangeTreeData: vscode.EventEmitter<EventItem | undefined | null | void> = new vscode.EventEmitter<EventItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<EventItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getChildren(element?: EventItem): ProviderResult<EventItem[]> {
        if (element === undefined) {
            return this.events;
        } else if (element.collapsibleState !== TreeItemCollapsibleState.None) {
            let children = [new EventItem(`topic: ${element.topic}`, '')];
            if (element.payload.length > 0) {
                children.push(new EventItem(`payload: ${element.payload}`, ''));
            }
            return children;
        }
        return undefined;
    }

    getTreeItem(element: EventItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    oldRefreshView(runtimeState?: OldRuntimeState): void {
        if (!!runtimeState) {
            this.events = runtimeState.getEvents();
            this._onDidChangeTreeData.fire();
        }
    }

    refreshView(runtimeState?: Context): void {
        if (runtimeState !== undefined) {
            this.events = runtimeState.events.values.map((ev: WASM.Event)=>{
                return new EventItem(ev.topic, ev.payload);
            });
            this._onDidChangeTreeData.fire();
        }
    }

    refreshEvents(events: WASM.Event[]): void {
        this.events = events.map((ev: WASM.Event)=>{
            return new EventItem(ev.topic, ev.payload);
        });
        this._onDidChangeTreeData.fire();
    }
}

export class EventItem extends vscode.TreeItem {
    topic: string;
    payload: string;

    constructor(topic: string, payload: string, treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        const label = treeItemCollapsibleState !== TreeItemCollapsibleState.None ? `Event for [${topic}]` : topic;
        super(label, treeItemCollapsibleState);
        this.topic = topic;
        this.payload = payload;
    }
}
