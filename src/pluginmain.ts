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

import * as ago from './ago'

// Installed via:
//   npm install --save-dev @types/jquery
// requires tsconfig: "allowSyntheticDefaultImports" : true 
declare var $: JQueryStatic;

declare var Dropbox: any; // from dropbox inport 


// Provide easy error handle for reporting errors from promises.  Usage:
//   p.catch(showError);
declare var showError: (error: any) => void; // error handler defined in index.html

// Map from UserId to user name
export interface IUserId2NameMap  {
    [colName: string]: string;
}

// https://www.dropbox.com/developers/chooser
interface IDropbboxFile {
    id: string;  // Unique ID for the file, compatible with Dropbox API v2.
    name: string; // name of the file, "filename.txt",

    // URL to access the file, which varies depending on the linkType specified when the
    // Chooser was triggered.
    link: string; //  "https://...",

    // Size of the file in bytes.
    bytes: number; // 464,

    // URL to a 64x64px icon for the file based on the file's extension.
    icon: string; //  "https://...",

    // A thumbnail URL generated when the user selects images and videos.
    // If the user didn't select an image or video, no thumbnail will be included.
    thumbnailLink: string; // "https://...?bounding_box=75&mode=fit",

    // Boolean, whether or not the file is actually a directory
    isDir: boolean; // false,
}

function Per(a: number, b: number): string {
    return (a * 100 / b).toFixed(1) + "%";
}

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
            plugin2.InitDropbox();
            if (throwError) {
                throw "some error";
            }

            return plugin2;
        });
    }

    private InitDropbox(): void {
        // Setup dropbox button 
        var options = {
            success: (files: IDropbboxFile[]) => {
                var file = files[0];
                var downloadLink = file.link;
                var filename = file.name;

                // On Chrome, current page is not "active tab", since the dropbox chooser dialog 
                // is still considered active when this callback is fired. 
                // https://www.chromestatus.com/feature/5637107137642496
                // So use a timer to def the dialog a second so that Dropbox window has closed. 
                setTimeout(() => {
                    this.onUpload(downloadLink, filename);
                }, 1000);
            },

            cancel: () => { },

            // Direct expires
            // Preview does not. 
            linkType: "preview", // direct, preview
            multiselect: false,
            extensions: ['.txt', '.csv']
        };

        var button = Dropbox.createChooseButton(options);
        document.getElementById("dropboxButton").appendChild(button);
    }

    // Expose constructor directly for tests. They can pass in mock versions. 
    public constructor(p: plugin.PluginClient) {
        this._sheet = new trcSheet.SheetClient(p.HttpClient, p.SheetId);
    }

    private getStatusText(descr: trcCompute.ISemanticDescrFull): string {
        if (!!descr.LastRefreshError) {
            return "Error!!: " + descr.LastRefreshError;
        }
        if (descr.StatusCode == 200) {
            return "Last updated " + ago.formatDateTime(descr.LastRefresh);
        }
        if (descr.StatusCode == 201) {
            return "Upload in progress";
        }
        return descr.StatusCode + "," + ago.formatDateTime(descr.LastRefreshError);
    }

    private pauseUi(): void {
        $("#_banner").show();
        $("#_editor").hide();
    }
    private resumeUi(): void {
        $("#_banner").hide();
        $("#_editor").show();
    }

    private _sheetInfo: trcSheet.ISheetInfoResult;

    // Return the userId in a semantic: users/{userId}/{name} 
    // Else return undefined  if no match
    private getUserIdFromName(sname: string): string {
        // Debug regex here: https://www.w3schools.com/jsref/tryit.asp?filename=tryjsref_regexp_exec
        // Beware, you can't share a regex instance - it can lead to non-deterministic 
        // matching behavior. 
        var _myRegexp = /users\/(.+)\/(.+)/g;
        var match = _myRegexp.exec(sname);
        if (!!match && match.length > 1) {
            return match[1];
        }
        return undefined;
    }

    // Given list of semantics, get the unique userIds in their names.     
    private GetUserIds(values: trcCompute.ISemanticDescrFull[]): string[] {

        var userIds: any = {};

        // Get unique set of userIds
        for (var i in values) {
            var descr = values[i];
            var userId: string = this.getUserIdFromName(descr.Name);
            if (!!userId) {
                userIds[userId] = true;
            }
        }

        var keys = Object.keys(userIds);
        return keys;
    }

    // Given list of semantics, compute a map of userId to ownerName.     
    // return {userId} ---> UserName
    private GetUserList(values: trcCompute.ISemanticDescrFull[]): Promise<IUserId2NameMap> {

        var userClient = new core.UserClient(this._sheet._http);

        var all: Promise<void>[] = [];
        var map: IUserId2NameMap = {};

        var keys = this.GetUserIds(values);
        keys.forEach((userId: string) => {
            all.push(userClient.getUserInfoAsync(userId).then(details => {
                //alert(userId + " =" + details.Email);
                map[userId] = details.Email;
            }));
        });

        return Promise.all(all).then(
            () => map);
    }

    private getDetailString(descr: trcCompute.ISemanticDescrFull): string {
        var t = "";
        var s = descr.Summary;
        if (!s) {
            return null;
        }
        t += "Details for: " + descr.Name;

        t +=
            "Rows         : " + s.TotalRows.toLocaleString() + "\n" +
            "Non Blank    : " + s.NonBlank.toLocaleString() + " (" + Per(s.NonBlank, s.TotalRows) + ") \n" +
            "Unique Values: " + s.UniqueVal + "\n";

        if (!!s.Average && !!s.Sum) {
            t +=
                "Average: " + s.Average.toLocaleString() + "\n" +
                "Sum    : " + s.Sum.toLocaleString() + "\n";
        };
        if (!!s.Histogram) {
            t += "-----\nHistogram:\n";
            var h = s.Histogram;
            for (var key in h) {
                if (h.hasOwnProperty(key)) {
                    var count = h[key];
                    if (key.length == 0) {
                        key = "(blank)";
                    }
                    t += "  " + key + " : " + count.toLocaleString() + " (" + Per(count, s.TotalRows) + ")\n";
                }
            }
        }
        return t;
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
                var c1 = $("<td>").text("Full Name");
                var c2 = $("<td>").text("# Rows");
                var c3 = $("<td>").text("Status");
                var c4 = $("<td>").text("Add to sheet?");
                var c5 = $("<td>").text("Ops");
                var c6 = $("<td>").text("Sharing");
                h1.append(c1);
                h1.append(c2);
                h1.append(c3);
                h1.append(c4);
                h1.append(c5);
                h1.append(c6);
                header.append(h1);
                root.append(header);
            }


            return this._sheet.getInfoAsync().then(sheetInfo => {
                this._sheetInfo = sheetInfo;

                if (!!sheetInfo.ParentId) {
                    // Only allow uploader on top-level sheets. 
                    var msg = "Data Uploader only allowed on top-level campaign sheets";
                    alert(msg);
                    throw msg;
                }

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

                    return this.GetUserList(values)
                        .then((userMap) => {
                            var countAdd = 0;
                            // $$$  Sort alphabetically? 
                            for (var i in values) {
                                var descr2 = values[i];
                                var [row, inc] = this.foreachDescr(descr2, used, userMap);

                                countAdd += inc;

                                root.append(row);
                            }


                            this.addSpecial(values);

                            if (countAdd == 0) {
                                $("#_addToSheet").hide();
                            }
                        });
                });
            });
        }); // caller will catch errors. 
    }


    // Callback in foreach loop for each descr
    private foreachDescr(
        descr: trcCompute.ISemanticDescrFull,
        used: any,
        userMap: IUserId2NameMap, // userId:string --> userName string 
    ): [JQuery<HTMLElement>, number] {

        var countAdd = 0;
        var sname = descr.Name;

        var sname2 = sname;
        var userId = this.getUserIdFromName(sname);
        if (!!userId) {
            var userName = userMap[userId];
            if (!!userName) {
                sname2 += " (" + userName + ")";
            }
        }

        var row = $("<tr>");
        var c1 = $("<td>").text(sname2);

        // Name may be "users/{userId}/name". 
        // Infer the UserId to help with identifying owner. 

        var c2 = $("<td>");
        var c2Text = this.SafeToString(descr.NumberRows);

        if (!!descr.Summary) {
            var c2Link = $("<a>").text(c2Text);
            c2.append(c2Link);
            c2.click(() => {
                var text = this.getDetailString(descr);
                alert(text);
            });
        } else {
            c2.text(c2Text);
        }

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

        var c5 = $("<td>");
        var btn2 = $("<button/>").addClass("btn").addClass("btn-danger").text("Delete").click(() => {
            var r = confirm("Are you sure you want to delete: " + sname);
            if (r == true) {
                this._sc.deleteAsync(sname).then(() => {
                    // Loop until 200? 
                    return this.InitAsync();
                }).catch(showError);
            }
        });
        c5.append(btn2);

        if (descr.Own) {
            var btn = $("<button/>").addClass("btn").text("Refresh").click(() => {
                this._sc.postRefreshAsync(sname).then(() => {
                    // Loop until 200? 
                    return this.InitAsync();
                }).catch(showError);
            });
            c5.append(btn);
        }

        var c6 = $("<td>");
        if (descr.Own) {
            var btn = $("<button/>").addClass("btn").addClass(".btn-warning").text("Share With..").click(() => {
                var newUser = prompt("Email address of user to share with?");
                if (newUser != null) {
                    this._sc.postShareAsync(sname, newUser).then(() => {
                        alert("Success: user now has access to this semantic.");
                    }).catch(showError);
                }
            });

            c6.append(btn);

            // Get current users 
            this.appendCurrentUsers(sname, c6);
        }


        row.append(c1);
        row.append(c2);
        row.append(c3);
        row.append(c4);
        row.append(c5);
        row.append(c6);

        //root.append(row);
        return [row, countAdd];
    }


    // This is many queries (1 per semantic), and it doesn't block the UI, so do it async.
    private appendCurrentUsers(sname: string, root: JQuery<HTMLElement>): void {
        this._sc.getAllUsersWithAccessAsync(sname).then(userDetails => {
            for (var userDetail of userDetails) {
                var e2 = $("<div>").text("[" + userDetail.Email + "] ");
                root.append(e2);
            }
        });
    }

    private addSpecial(values: trcCompute.ISemanticDescrFull[]) {
        if (values.length == 0) {
            return;
        }

        // Can only edit these if we're the top sheet. 

        // XVoted, Set this to mark who has currently voted, [Dropdown], Add it
        var root = $("#_listSpecial");
        root.empty();
        {
            var header = $("<thead>");
            var h1 = $("<tr>");
            var c1 = $("<td>").text("Column Name");
            var c2 = $("<td>").text("Description");
            var c3 = $("<td>").text("Current value?");

            var c4 = $("<td>").text("Semantic");
            var c5 = $("<td>").text("Ops");
            h1.append(c1);
            h1.append(c2);
            h1.append(c3);
            h1.append(c4);
            h1.append(c5);
            header.append(h1);
            root.append(header);
        }

        var tr1 = this.addSpecialRow("XVoted", "who has currently voted", values);
        var tr2 = this.addSpecialRow("XTargetPri", "mark targetted voters", values);
        var tr3 = this.addSpecialRow("Party", "party id", values);
        var tr4 = this.addSpecialRow("Cellphone", "Phone numbers", values);
        var tr5 = this.addSpecialRow("History", "likeliness to vote", values);
        root.append(tr1);
        root.append(tr2);
        root.append(tr3);
        root.append(tr4);
        root.append(tr5);
    }

    private addSpecialRow(
        columnName: string,
        columnDescr: string,
        values: trcCompute.ISemanticDescrFull[]
    ): JQuery<HTMLElement>  // returns a <tr>
    {
        var tr = $("<tr>");

        var td1 = $("<td>").text(columnName);
        var td2 = $("<td>").text(columnDescr);

        var td3 = $("<td>"); // Current value  
        {
            var cs = this._sheetInfo.Columns;

            var str: string = "(not used)";
            for (var i in cs) {
                var c = cs[i];

                if (c.Name.toUpperCase() == columnName.toUpperCase()) {
                    str = c.Expression;
                    if (!str) {
                        str = c.Semantic;
                    }
                    if (!str) {
                        str = "(unknown)";
                    }
                    break;
                }
            }
            td3.text(str);
        }

        var td4 = $("<td>"); // Option list 

        {
            var sel = $("<select>").attr("id", "add_" + columnName);
            sel.append($("<option>").text("(please select)"));

            for (var i in values) {
                var val: string = values[i].Name;
                var opt = $("<option>").val(val).text(val);
                sel.append(opt);
            }
            td4.append(sel);
        }

        var td5 = $("<td>");
        var btn = this.addSpecialButton(columnName);
        td5.append(btn);


        tr.append(td1);
        tr.append(td2);
        tr.append(td3);
        tr.append(td4);
        tr.append(td5);

        return tr;
    }

    private addSpecialButton(columnName: string)
        : JQuery<HTMLElement> // returns a button 
    {
        var btn = $("<button/>").addClass("btn").text("Add").click(() => {
            // Get semanticName from currently selected
            var semanticName: string = <string>$("#add_" + columnName).val();
            if (!semanticName || semanticName.length == 0) {
                alert("Please select a semantic");
                return;
            }

            var ok = confirm("Do you want to add '" + columnName + "' as '" + semanticName + "'.");
            if (!ok) {
                return;
            }

            var questions: trcSheet.IMaintenanceAddColumn[] = [];
            questions.push(
                {
                    ColumnName: columnName,
                    Description: null,
                    PossibleValues: null,
                    SemanticName: semanticName,
                }
            );

            var admin = new trcSheet.SheetAdminClient(this._sheet);

            admin.postOpAddQuestionAsync(questions).then(
                () => {
                    return this.InitAsync();
                }
            ).catch(showError);
        });

        return btn;
    }


    // When they uploaded from the dropbox selector. 
    public onUpload(url: string, filename: string): void {
        // https://www.dropbox.com/developers/chooser
        // "Direct" links - you can do a GET and get the contents, but they expire after 4 hours. 
        // Need a "preview" link, which will return a 302 (and do an auth check), 
        // and the new URL will get the contents 

        // DL=0 means preview, DL=1 will get a direct link 

        // Change the dl=0  to dl=1  
        url = url.replace("dl=0", "dl=1");

        // https://stackoverflow.com/questions/4250364/how-to-trim-a-file-extension-from-a-string-in-javascript
        var defaultName = filename.toLocaleLowerCase().replace(/\.[^/.]+$/, ""); // remove extension 

        try {
            trcSheet.Validators.ValidateColumnName(defaultName);
        } catch {
            // Don't suggest a default name that's illegal.
            defaultName = undefined;
        }

        var name = prompt("Short name of data file? [a-z0-9_]?", defaultName);
        if (name == null) {
            // Beware, this can happen for https://www.chromestatus.com/feature/5637107137642496
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


        // If this is voted, then use well-k
        if (last.indexOf("voted") !== -1) {
            var msg = "Do you want to use '" + last + "' as list of who has voted? (This will rename the column to 'XVoted') ";
            if (confirm(msg)) {
                // Use special column name
                last = "XVoted";
            }
        }
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

    private SafeToString(val: any): string {
        if (!val) {
            return "n/a";
        }
        return val.toLocaleString();
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