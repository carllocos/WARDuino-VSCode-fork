import { ProxyCallItem } from '../Views/ProxyCallsProvider';

export async function toggleProxyCall(resource: ProxyCallItem) {
    if(resource.isSelected()){
        await resource.dbg.targetVM.unregisterFuncForProxyCall(resource.func, 3000);
    }
    else{
        await resource.dbg.targetVM.registerFuncForProxyCall(resource.func, 3000);
    }
    resource.provider.refreshView();
}