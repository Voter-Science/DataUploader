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

// Installed via:
//   npm install --save-dev @types/jquery
// requires tsconfig: "allowSyntheticDefaultImports" : true 
declare var $: JQueryStatic;

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

    private getStatusText(descr: trcCompute.ISemanticDescrFull): string {
        if (!!descr.LastRefreshError) {
            return "Error: " + descr.LastRefreshError;
        }
        if (descr.StatusCode == 200) {
            return "Ok -" + descr.LastRefresh;
        }
        if (descr.StatusCode == 201) {
            return "Upload in progress";
        }
        return descr.StatusCode + "," + descr.LastRefreshError;
    }

    private pauseUi(): void {
        $("#_banner").show();
        $("#_editor").hide();
    }
    private resumeUi(): void {
        $("#_banner").hide();
        $("#_editor").show();
    }
    private InitAsync(): Promise<void> {
        this.pauseUi();

        var admin = new trcSheet.SheetAdminClient(this._sheet);
        return admin.WaitAsync().then(() => {
            this.resumeUi();

            // Name, #, "Used in this sheet?", Status,  Ops [Refresh, Delete, Add to this sheet ]

            var used: any = {}; // Semantic --> Column in this sheet that uses it. 

            var root = $("#_list");
            root.empty();
            {
                var header = $("<thead>");
                var h1 = $("<tr>");
                var c1 = $("<td>").text("Name");
                var c2 = $("<td>").text("#");
                var c3 = $("<td>").text("Status");
                var c4 = $("<td>").text("Add to sheet?");
                var c5 = $("<td>").text("Ops");
                h1.append(c1);
                h1.append(c2);
                h1.append(c3);
                h1.append(c4);
                header.append(h1);
                root.append(header);
            }


            return this._sheet.getInfoAsync().then(sheetInfo => {

                $("#_addToSheet").show();

                // Track which semantics the current sheet is already using. 
                var cs = sheetInfo.Columns;
                for (var i in cs) {
                    var c = cs[i];
                    var s: string = c.Semantic;
                    if (!!s) {
                        // Column Name 
                        used[s] = c.Name;
                    }
                }

                return this._sc.getListAsync().then(semanticList => {
                    // List of possible semantics 

                    var values = semanticList.Results;

                    if (values.length == 0) {
                        // Don't have permission to any semantics. 
                        $("#_panel2").hide();
                        return;
                    }
                    $("#_panel2").show();

                    var countAdd = 0;
                    // $$$  Sort alphabetically? 
                    for (var i in values) {
                        var descr2 = values[i];

                        ((descr) => {
                            var sname = descr.Name;

                            var row = $("<tr>");
                            var c1 = $("<td>").text(sname);
                            var c2 = $("<td>").text(descr.NumberRows);
                            var c3 = $("<td>").text(this.getStatusText(descr));

                            var usedBycolumnName = used[descr.Name];
                            if (!!usedBycolumnName) {
                                var c4 = $("<td>").text("(included as " + usedBycolumnName + ")");
                            } else {
                                // Create a checkbox for adding... 
                                // var c4 = $("<td>").text("Add it!");

                                var chk = $("<input class='myx' type='checkbox' />").val(sname).text('Add');

                                var c4 = $("<td>");
                                c4.append(chk);
                                countAdd++;
                            }

                            var btn = $("<button/>").addClass("btn").text("Refresh").click(() => {
                                this._sc.postRefreshAsync(sname).then(() => {
                                    // Loop until 200? 
                                    return this.InitAsync();
                                }).catch(showError);
                            });
                            var btn2 = $("<button/>").addClass("btn").addClass("btn-danger").text("Delete").click(() => {
                                var r = confirm("Are you sure you want to delete: " + sname);
                                if (r == true) {
                                    this._sc.deleteAsync(sname).then(() => {
                                        // Loop until 200? 
                                        return this.InitAsync();
                                    }).catch(showError);
                                }
                            });
                            var c5 = $("<td>");
                            c5.append(btn);
                            c5.append(btn2);


                            row.append(c1);
                            row.append(c2);
                            row.append(c3);
                            row.append(c4);
                            row.append(c5);
                            root.append(row);
                        })(descr2);
                    }


                    if (countAdd == 0) {
                        $("#_addToSheet").hide();
                    }
                });
            });
        }).catch(showError);;
    }

    // When they uploaded from the dropbox selector. 
    public onUpload(url: string): void {
        var name = prompt("Name of data file? [a-z0-9_]?");
        if (name == null) {
            return; // cancelled. 
        }

        try {
            trcSheet.Validators.ValidateColumnName(name);
        }
        catch (e) {
            showError(e);
            return;
        }

        var descr: trcCompute.ISemanticDescr = {
            Name: name,
            Description: null,
            UrlSource: url
        };
        this._sc.postCreateAsync(descr).then((descr2) => { // Fast 
            return this._sc.postRefreshAsync(descr2.Name).then(() => { // Possibly long running 
                // Refresh so we can see it. 
                return this.InitAsync();
            });
        }).catch(showError);
    }

    // Given a semantic name, pick a meaningful column name 
    private pickColumnName(sname: string): string {
        // semantic name is like 'users/foo/test1' 
        // Take the last section 'test1'
        var parts = sname.split('/');
        var last = parts[parts.length - 1];
        return last;
    }
    public onAddToSheet(): void {

        var questions: trcSheet.IMaintenanceAddColumn[] = [];
        var list = "";
        $(".myx").each((i, html) => {
            var e = $(html);
            var checked = e.is(':checked');
            if (checked) {
                var sname: string = <string>e.val();

                questions.push(
                    {
                        ColumnName: this.pickColumnName(sname),
                        Description: null,
                        PossibleValues: null,
                        SemanticName: sname,
                    }
                );
            }
        });

        if (questions.length == 0) {
            alert("Please check the boxes next to semantics you want to add.");
            return;
        }

        var admin = new trcSheet.SheetAdminClient(this._sheet);

        admin.postOpAddQuestionAsync(questions).then(
            () => {
                return this.InitAsync();
            }
        ).catch(showError);
    }

    public onRefresh(): void {
        var admin = new trcSheet.SheetAdminClient(this._sheet);
        admin.postOpRefreshAsync().then(
            () => {
                return this.InitAsync();
            }
        ).catch(showError);
    }

    // Display sheet info on HTML page
    public updateInfo(info: trcSheet.ISheetInfoResult): void {
        $("#SheetName").text(info.Name);
        $("#ParentSheetName").text(info.ParentName);
        $("#SheetVer").text(info.LatestVersion);
        $("#RowCount").text(info.CountRecords);

        $("#LastRefreshed").text(new Date().toLocaleString());
    }
}

declare var _plugin: MyPlugin;
declare var Dropbox: any; // from dropbox inport 

$(function () {
    // Setup dropbox button 
    var options = {
        success: function (files: any) {
            var downloadLink = files[0].link;
            _plugin.onUpload(downloadLink);
        },

        cancel: function () {
        },

        linkType: "direct", // direct, preview
        multiselect: false,
        extensions: ['.txt', '.csv']
    };

    var button = Dropbox.createChooseButton(options);
    document.getElementById("dropboxButton").appendChild(button);
});