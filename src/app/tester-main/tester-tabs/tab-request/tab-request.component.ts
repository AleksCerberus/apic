import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngxs/store';
import { from, Observable, Subject } from 'rxjs';
import { delayWhen, takeUntil } from 'rxjs/operators';
import { ConfirmService } from 'src/app/directives/confirm.directive';
import { KeyVal } from 'src/app/models/KeyVal.model';
import { ApiRequest } from 'src/app/models/Request.model';
import { InterpolationService } from 'src/app/services/interpolation.service';
import LocalStore from 'src/app/services/localStore';
import { RememberService } from 'src/app/services/remember.service';
import { RequestRunnerService, RunResponse, RunResult } from 'src/app/services/request-runner.service';
import { RequestsService } from 'src/app/services/requests.service';
import { Toaster } from 'src/app/services/toaster.service';
import { Utils } from 'src/app/services/utils.service';
import { RequestsStateSelector } from 'src/app/state/requests.selector';
import apic from 'src/app/utils/apic';
import { Beautifier } from 'src/app/utils/Beautifier';
import { HTTP_HEADERS, HTTP_METHODES, METHOD_WITH_BODY, RAW_BODY_TYPES } from 'src/app/utils/constants';
import { SaveReqDialogComponent } from '../../save-req-dialog/save-req-dialog.component';
import { TesterTabsService } from '../tester-tabs.service';

@Component({
  selector: 'app-tab-request',
  templateUrl: './tab-request.component.html',
  styleUrls: ['./tab-request.component.scss'],
  providers: [RequestRunnerService] //to make sure each tab gets one instance of runner service
})
export class TabRequestComponent implements OnInit, OnDestroy, OnChanges {
  @Input() requestId: string;
  selectedReq: ApiRequest;
  selectedReq$: Observable<ApiRequest>;
  private pendingAction: Promise<any> = Promise.resolve(null);

  httpMethods = HTTP_METHODES;
  RAW_BODY_TYPES = RAW_BODY_TYPES;
  HTTP_HEADERS = HTTP_HEADERS;
  form: FormGroup;
  private _destroy: Subject<boolean> = new Subject<boolean>();

  dummy = ''
  runResponse: RunResponse;
  reloadRequest: ApiRequest = null;
  flags = {
    showReq: true,
    showResp: true,
    reqTab: 'auth_basic',
    respTab: 'Body', //Body,Tests,Headers,Logs,
    respBodyTab: 'pretty', //pretty, raw, preview
    respAceMode: 'json',
    urlParamsCount: 0,
    headersCount: 0,
    respHeadersCount: 0,
    runCount: 2,
    running: false
  }
  constructor(private fb: FormBuilder,
    private store: Store,
    private tabsService: TesterTabsService,
    private reqService: RequestsService,
    private dialog: MatDialog,
    private utils: Utils,
    private runner: RequestRunnerService,
    public interpolationService: InterpolationService,
    private toastr: Toaster) {
    this.form = fb.group({
      name: [''],
      description: [''],
      method: ['GET'],
      url: ['http://localhost:5000/app/src/#!/apic/home/{{x}}'],
      urlParams: [[]],
      headers: [[]],
      body: fb.group({
        type: ['raw'],
        selectedRaw: [{ name: "JSON", val: "application/json" }],
        xForms: [[]],
        formData: [[]],
        rawData: [''],
        gqlVars: ['']
      }),
      savedResp: [[]],
      prescript: [''],
      postscript: [''],
      respCodes: [[]]
    });

    this.form.controls.urlParams.valueChanges
      .pipe(takeUntil(this._destroy))
      .subscribe((value: KeyVal[]) => {
        this.flags.urlParamsCount = value.filter(v => v.key).length;
      })
    this.form.controls.headers.valueChanges
      .pipe(takeUntil(this._destroy))
      .subscribe((value: KeyVal[]) => {
        this.flags.headersCount = value.filter(v => v.key).length;
      })

    //load last layout
    this.flags.reqTab = LocalStore.get(LocalStore.REQ_TAB) || 'ReqParam';
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes.requestId?.previousValue?.includes('new_tab') && !changes.requestId?.currentValue?.includes('new_tab')) {
      this.listenForUpdate()
    }
  }

  ngOnDestroy(): void {
    this._destroy.next();
    this._destroy.complete();
  }

  ngOnInit(): void {
    if (!this.requestId.includes('new_tab')) {
      this.listenForUpdate()
    }
  }

  listenForUpdate() {
    this.selectedReq$ = this.store.select(RequestsStateSelector.getRequestByIdDynamic(this.requestId));
    this.selectedReq$
      .pipe(delayWhen(() => from(this.pendingAction)))
      .pipe(takeUntil(this._destroy))
      // .pipe(delay(0))
      .subscribe(req => {
        if (req && (req._modified > this.selectedReq?._modified || !this.selectedReq)) {
          if (this.selectedReq) {
            this.reloadRequest = req;
          } else {
            setTimeout(() => {
              this.processSelectedReq(req)
            }, 0);
          }
        } else if (req == undefined && this.selectedReq) {
          //tab got deleted
          this.tabsService.updateTab(this.requestId, 'new_tab:' + apic.s8(), 'Deleted Tab: ' + this.selectedReq.name);
        }
      })
  }

  processSelectedReq(req: ApiRequest) {
    this.selectedReq = req;
    const { url, method, name, description, Req: { headers, url_params }, postscript, prescript, savedResp, respCodes } = req;
    this.form.patchValue({
      name,
      description,
      method,
      url,
      urlParams: url_params,
      headers,
      savedResp,
      prescript,
      postscript,
      respCodes: respCodes || []
    });
    if (req.Body) {
      const { Body: { rawData, selectedRaw, type, gqlVars, formData, xForms } } = req;
      this.form.patchValue({
        body: {
          type: type,
          selectedRaw: selectedRaw || { name: "JSON", val: "application/json" },
          xForms: xForms || [],
          formData: formData || [],
          rawData,
          gqlVars
        }
      })
    }

    this.form.markAsPristine();
  }

  async initReqSave(saveAs: boolean = false) {
    // if(fromProject?){
    //   update the endpoint with prerun and postrun
    // }
    let saveData: ApiRequest = this.getReqFromForm();
    if (this.requestId.includes('new_tab') || saveAs) {
      this.dialog.open(SaveReqDialogComponent, { data: { req: saveData, action: (saveAs ? 'saveAs' : 'new') }, width: '600px' });
    } else {
      this.pendingAction = this.reqService.updateRequests([{ ...saveData, _created: this.selectedReq._created, _modified: this.selectedReq._modified }]);
      try {
        this.selectedReq = (await this.pendingAction)[0];
        this.toastr.success('Request updated');
        this.reloadRequest = null;
      } catch (e) {
        console.error(e)
        this.toastr.error(`Failed to update request: ${e.message}`);
      }
    }
  }

  getReqFromForm(): ApiRequest {
    let request = this.form.value;
    let saveData: ApiRequest = {
      url: request.url,
      method: request.method,
      description: request.description,
      Req: {
        url_params: request.urlParams,
        headers: request.headers
      },
      Body: null,
      _id: this.requestId,
      respCodes: request.respCodes,
      prescript: request.prescript,
      postscript: request.postscript,
      name: request.name,
      savedResp: request.savedResp,
      _parent: this.selectedReq?._parent
    }
    if (METHOD_WITH_BODY.includes(request.method)) {
      let body = { type: request.body.type };
      switch (request.body.type) {
        case 'form-data':
          saveData.Body = { ...body, formData: request.body.formData };
          //TODO: Handle the input type file eg: formatRequestForSave
          break;
        case 'x-www-form-urlencoded':
          saveData.Body = { ...body, xForms: request.body.xForms };
          break;
        case 'raw':
          saveData.Body = { ...body, selectedRaw: request.body.selectedRaw, rawData: request.body.rawData };
          break;
        case 'graphql':
          saveData.Body = { ...body, selectedRaw: request.body.selectedRaw, rawData: request.body.rawData, gqlVars: request.body.gqlVars };
          break;
      }
    }

    return saveData;
  }

  selectTab(type: string, name: string) {
    this.flags[type] = name;
    LocalStore.set(type, name);
    //TODO: Utils.storage.set(type, name);
  }

  initRawBody() {
    // request.Editor.Req.object.completers = [];
    // changeEditorMode(request.Body.selectedRaw.name, 'Req');
  }
  initGQLBody() {
    // request.Editor.Req.object.completers = [{
    //     getCompletions: function (editor, session, pos, prefix, callback) {
    //         callback(null, request.GQLSuggests);
    //     }
    // }]
    // changeEditorMode('graphql', 'Req');
    // GraphQL.loadSchema(request.URL, request.METHOD).then(function (types) {
    //     console.log(types);
    //     request.GQLTypes = types;
    //     request.GQLSuggests = types.suggests;
    //     delete types.suggests;
    // }, function (e) {
    //     request.GQLTypes = null;
    // })
  }

  removeAuthHeader() {
    this.form.patchValue({ headers: this.form.value.headers.filter((h: KeyVal) => h.key.toLocaleLowerCase() !== 'authorization') })
    this.toastr.info('Authorization header removed.');
  }
  updateHeader(name: string, value: string) {
    let headers: KeyVal[] = this.form.value.headers.filter((h: KeyVal) => h.key.toLocaleLowerCase() !== name.toLocaleLowerCase());
    this.form.patchValue({ headers: [...headers, { key: name, val: value, active: true }] });
    this.toastr.info('Header updated');
  }
  prerunUpdated(newVal) {
    if (newVal != this.form.value.prescript) {
      this.form.patchValue({ prescript: newVal });
      this.setDirty();
    }
  }

  postrunUpdated(newVal) {
    if (newVal != this.form.value.postscript) {
      this.form.patchValue({ postscript: newVal });
      this.setDirty();
    }
  }

  copyCompiledUrl() {
    this.utils.copyToClipboard(this.interpolationService.interpolate(this.form.value.url))
  }

  setDirty() {
    this.form.markAsDirty();
  }

  reload() {
    this.processSelectedReq(this.reloadRequest)
    this.reloadRequest = null
  }

  async doSingleRun() {
    this.applyRunStatus(true);
    const req: ApiRequest = this.getReqFromForm();
    let result: RunResult = await this.runner.run(req);
    console.log(result);
    this.runResponse = result.resp;
    this.runResponse.bodyPretty = this.beautifyResponse(this.runResponse?.headers?.['Content-Type'], this.runResponse.body);
    this.flags.respHeadersCount = Utils.objectKeys(this.runResponse.headers).length;
    this.applyRunStatus(false);
  }

  startLoopRun() {

  }
  abortRun() {
    this.applyRunStatus(false);
    this.runner.abort();
  }
  beautifyResponse(contentType: string, body: string): string {
    //formatting response for pretty print
    if (contentType?.includes('json')) {
      this.flags.respAceMode = 'json';
      return Beautifier.json(body)
    } else if (contentType?.includes('xml') || contentType?.includes('html')) {
      this.flags.respAceMode = 'xml';
      return Beautifier.xml(body);
    } else if (contentType?.includes('javascript')) {
      this.flags.respAceMode = 'javascript';
      return Beautifier.javascript(body)
    } else {
      //attepmt to use json, fallback to text
      try {
        this.flags.respAceMode = 'json';
        return Beautifier.json(body)
      } catch (e) {
        this.flags.respAceMode = 'text';
        return body
      }
    }
  }

  applyRunStatus(running: boolean) {
    this.flags.running = running;
    if (running) {
      this.form.disable();
    } else {
      this.form.enable()
    }
  }
}
