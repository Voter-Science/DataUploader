// Sample 'Hello World' Plugin template.
// Demonstrates:
// - typescript
// - using trc npm modules and browserify
// - uses promises. 
// - basic scaffolding for error reporting. 
// This calls TRC APIs and binds to specific HTML elements from the page.  

import * as XC from 'trc-httpshim/xclient'
import * as common from 'trc-httpshim/common'

import * as core from 'trc-core/core'

import * as trcSheet from 'trc-sheet/sheet'
import * as trcSheetEx from 'trc-sheet/sheetEx'
import * as trcCompute from 'trc-sheet/computeClient'

import * as plugin from 'trc-web/plugin'
import * as trchtml from 'trc-web/html'


declare var $: any; // external definition for JQuery 

// Provide easy error handle for reporting errors from promises.  Usage:
//   p.catch(showError);
declare var showError: (error: any) => void; // error handler defined in index.html

export class MyPlugin {
    private _sheet: trcSheet.SheetClient;
    private _pluginClient: plugin.PluginClient;

    private _sc: trcCompute.SemanticClient;

    public static BrowserEntryAsync(
        auth: plugin.IStart,
        opts: plugin.IPluginOptions
    ): Promise<MyPlugin> {

        var pluginClient = new plugin.PluginClient(auth, opts);

        // Do any IO here...

        var throwError = false; // $$$ remove this

        var plugin2 = new MyPlugin(pluginClient);
        plugin2._sc = new trcCompute.SemanticClient(pluginClient.HttpClient);

        return plugin2.InitAsync().then(() => {
            if (throwError) {
                throw "some error";
            }

            return plugin2;
        });
    }

    // Expose constructor directly for tests. They can pass in mock versions. 
    public constructor(p: plugin.PluginClient) {
        this._sheet = new trcSheet.SheetClient(p.HttpClient, p.SheetId);
    }


    // Make initial network calls to setup the plugin. 
    // Need this as a separate call from the ctor since ctors aren't async. 
    private InitAsync(): Promise<void> {

        return this._sheet.getInfoAsync().then(info => {
            var root = $("#_list");
            root.empty();
            // List existing data in the sheet 
            var cs = info.Columns;
            for (var i in cs) {
                var c = cs[i];
                var s = (<any>c).Semantic;
                if (!!s) {
                    var item = $("<li/>").text(s);
                    root.append(item);
                }
            }
        }).then(() => {
            this._sc.getListAsync().then(list => {
                var root = $("#_semantics");
                root.empty();
                var values = list.Results;
                for (var i in values) {
                    var name = values[i];
                    var item = $("<option/>").val(name).text(name);
                    root.append(item);
                }
            });
        });
    }

    public onUpload(url: string): void {
        var name = prompt("Name of data file? [a-z0-9_]?");
        if (name == null)
        {
            return; // cancelled. 
        }

        var descr: trcCompute.ISemanticDescr = {
            Name: name,
            Description: null,
            UrlSource: url
        };
        this._sc.postUploadAsync(descr).then (()=> {
            // Refersh so we can see it. 
            return this.InitAsync();
        }).catch(showError);
    }

    // Display sheet info on HTML page
    public updateInfo(info: trcSheet.ISheetInfoResult): void {
        $("#SheetName").text(info.Name);
        $("#ParentSheetName").text(info.ParentName);
        $("#SheetVer").text(info.LatestVersion);
        $("#RowCount").text(info.CountRecords);

        $("#LastRefreshed").text(new Date().toLocaleString());
    }

    // Example of a helper function.
    public doubleit(val: number): number {
        return val * 2;
    }

    // Demonstrate receiving UI handlers 
    public onClickRefresh(): void {
        this.InitAsync().
            catch(showError);
    }
}
