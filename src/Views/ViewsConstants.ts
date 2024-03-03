
/*
* shows the views of package.json
*/

import { BreakpointPolicyProvider } from './BreakpointPolicyProvider';
import { EventsProvider } from './EventsProvider';
import { OutOfThingsSessionProvider } from './OutOfThingsSessionProvider';
import { ProxyCallsProvider } from './ProxyCallsProvider';
import { StackProvider } from './StackProvider';

export interface ViewsConfig {
    id: string,
    name: string,
    group: string,
    when: string,
}

export const EVENTSVIEWCONFIG: ViewsConfig = {
    id: 'events',
    name: 'events',
    group: 'navigation',
    when: 'warduinodebug.showEvents'
};

export const STACKVIEWCONFIG  = {
    id: 'stack',
    name: 'stack',
    group: 'navigation',
    when: 'warduinodebug.showStack'
};

export const DEBUGGINGTIMELINEVIEWCONFIG  = {
    id: 'debuggingTimeline',
    name: 'Debugging Timeline',
    group: 'navigation',
    when: 'warduinodebug.showDebuggingTimeLine'
};

export const OOTMONITORVIEWCONFIG  = {
    id: 'ootMonitor',
    name: 'sessions',
    group: 'navigation',
    when: 'warduinodebug.showSessions'
};

export const PROXIESVIEWCONFIG  = {
    id: 'proxies',
    name: 'proxies',
    group: 'navigation',
    when: 'warduinodebug.showProxies'
};

export const BREAKPOINTPOLICIESVIEWCONFIG  = {
    id: 'breakpointPolicies',
    name: 'breakpoint Policies',
    group: 'navigation',
    when: 'warduinodebug.showBreakpointPolicies'
};


export const DEVICESVIEWCONFIG  = {
    id: 'devicesView',
    name: 'Devices Debugged',
    group: 'navigation',
    when: 'warduinodebug.showDevicesView'
};


export const STACK_PROVIDER = new StackProvider();
export const EVENTS_PROVIDER = new EventsProvider();
export const BREAKPOINT_POLICY_PROVIDER = new BreakpointPolicyProvider();
export const SESSION_PROVIDER = new OutOfThingsSessionProvider();
export const PROXIES_PROVIDER = new ProxyCallsProvider();